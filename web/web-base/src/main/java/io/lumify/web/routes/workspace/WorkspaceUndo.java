package io.lumify.web.routes.workspace;

import com.google.inject.Inject;
import io.lumify.core.config.Configuration;
import io.lumify.core.exception.LumifyException;
import io.lumify.core.model.audit.AuditAction;
import io.lumify.core.model.audit.AuditRepository;
import io.lumify.core.model.properties.LumifyProperties;
import io.lumify.core.model.termMention.TermMentionRepository;
import io.lumify.core.model.user.UserRepository;
import io.lumify.core.model.workQueue.WorkQueueRepository;
import io.lumify.core.model.workspace.WorkspaceRepository;
import io.lumify.core.security.LumifyVisibility;
import io.lumify.core.security.VisibilityTranslator;
import io.lumify.core.user.User;
import io.lumify.core.util.GraphUtil;
import io.lumify.core.util.LumifyLogger;
import io.lumify.core.util.LumifyLoggerFactory;
import io.lumify.miniweb.HandlerChain;
import io.lumify.web.BaseRequestHandler;
import io.lumify.web.clientapi.model.SandboxStatus;
import io.lumify.web.clientapi.model.VisibilityJson;
import org.json.JSONArray;
import org.json.JSONObject;
import org.securegraph.*;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import static com.google.common.base.Preconditions.checkNotNull;

public class WorkspaceUndo extends BaseRequestHandler {
    private static final LumifyLogger LOGGER = LumifyLoggerFactory.getLogger(WorkspaceUndo.class);
    private final TermMentionRepository termMentionRepository;
    private final Graph graph;
    private final VisibilityTranslator visibilityTranslator;
    private final UserRepository userRepository;
    private final WorkQueueRepository workQueueRepository;
    private final AuditRepository auditRepository;
    private final WorkspaceHelper workspaceHelper;
    private final String entityHasImageIri;
    private final String artifactContainsImageOfEntityIri;

    @Inject
    public WorkspaceUndo(
            final TermMentionRepository termMentionRepository,
            final Configuration configuration,
            final Graph graph,
            final VisibilityTranslator visibilityTranslator,
            final UserRepository userRepository,
            final WorkspaceHelper workspaceHelper,
            final WorkspaceRepository workspaceRepository,
            final WorkQueueRepository workQueueRepository,
            final AuditRepository auditRepository) {
        super(userRepository, workspaceRepository, configuration);
        this.termMentionRepository = termMentionRepository;
        this.graph = graph;
        this.visibilityTranslator = visibilityTranslator;
        this.workspaceHelper = workspaceHelper;
        this.userRepository = userRepository;
        this.workQueueRepository = workQueueRepository;
        this.auditRepository = auditRepository;

        this.entityHasImageIri = this.getConfiguration().get(Configuration.ONTOLOGY_IRI_ENTITY_HAS_IMAGE);
        if (this.entityHasImageIri == null) {
            throw new LumifyException("Could not find configuration for " + Configuration.ONTOLOGY_IRI_ENTITY_HAS_IMAGE);
        }

        this.artifactContainsImageOfEntityIri = this.getConfiguration().get(Configuration.ONTOLOGY_IRI_ARTIFACT_CONTAINS_IMAGE_OF_ENTITY);
        if (this.artifactContainsImageOfEntityIri == null) {
            throw new LumifyException("Could not find configuration for " + Configuration.ONTOLOGY_IRI_ARTIFACT_CONTAINS_IMAGE_OF_ENTITY);
        }
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, HandlerChain chain) throws Exception {
        final JSONArray undoData = new JSONArray(getRequiredParameter(request, "undoData"));
        User user = getUser(request);
        Authorizations authorizations = getAuthorizations(request, user);
        String workspaceId = getActiveWorkspaceId(request);

        JSONArray failures = new JSONArray();
        JSONArray verticesDeleted = new JSONArray();

        for (int i = 0; i < undoData.length(); i++) {
            JSONObject data = undoData.getJSONObject(i);
            String type = data.getString("type");
            if (type.equals("vertex")) {
                checkNotNull(data.getString("vertexId"));
                Vertex vertex = graph.getVertex(data.getString("vertexId"), authorizations);
                checkNotNull(vertex);
                if (data.getString("status").equals(SandboxStatus.PUBLIC.toString())) {
                    String msg = "Cannot undo a public vertex";
                    LOGGER.warn(msg);
                    data.put("error_msg", msg);
                    failures.put(data);
                    continue;
                }
                undoVertex(vertex, workspaceId, authorizations, user);
                verticesDeleted.put(vertex.getId());
            } else if (type.equals("relationship")) {
                Vertex sourceVertex = graph.getVertex(data.getString("sourceId"), authorizations);
                Vertex destVertex = graph.getVertex(data.getString("destId"), authorizations);
                if (sourceVertex == null || destVertex == null) {
                    continue;
                }
                Edge edge = graph.getEdge(data.getString("edgeId"), authorizations);
                checkNotNull(edge);
                if (data.getString("status").equals(SandboxStatus.PUBLIC.toString())) {
                    String error_msg = "Cannot undo a public edge";
                    LOGGER.warn(error_msg);
                    data.put("error_msg", error_msg);
                    failures.put(data);
                    continue;
                }
                workspaceHelper.deleteEdge(edge, sourceVertex, destVertex, entityHasImageIri, user, authorizations);
            } else if (type.equals("property")) {
                checkNotNull(data.getString("vertexId"));
                Vertex vertex = graph.getVertex(data.getString("vertexId"), authorizations);
                if (vertex == null) {
                    continue;
                }
                if (data.getString("status").equals(SandboxStatus.PUBLIC.toString())) {
                    String error_msg = "Cannot undo a public property";
                    LOGGER.warn(error_msg);
                    data.put("error_msg", error_msg);
                    failures.put(data);
                    continue;
                }
                Property property = vertex.getProperty(data.getString("key"), data.getString("name"));
                workspaceHelper.deleteProperty(vertex, property, workspaceId, user, authorizations);
            }
        }

        if (verticesDeleted.length() > 0) {
            workQueueRepository.pushVerticesDeletion(verticesDeleted);
        }

        JSONObject resultJson = new JSONObject();
        resultJson.put("failures", failures);
        respondWithJson(response, resultJson);
    }

    private JSONArray undoVertex(Vertex vertex, String workspaceId, Authorizations authorizations, User user) {
        JSONArray unresolved = new JSONArray();
        VisibilityJson visibilityJson = LumifyProperties.VISIBILITY_JSON.getPropertyValue(vertex);
        visibilityJson = GraphUtil.updateVisibilityJsonRemoveFromAllWorkspace(visibilityJson);
        LumifyVisibility lumifyVisibility = visibilityTranslator.toVisibility(visibilityJson);

        for (Edge edge : vertex.getEdges(Direction.BOTH, entityHasImageIri, authorizations)) {
            if (edge.getVertexId(Direction.IN).equals(vertex.getId())) {
                Vertex outVertex = edge.getVertex(Direction.OUT, authorizations);
                Property entityHasImage = outVertex.getProperty(LumifyProperties.ENTITY_HAS_IMAGE_VERTEX_ID.getPropertyName());
                outVertex.removeProperty(entityHasImage.getName(), authorizations);
                this.workQueueRepository.pushElementImageQueue(outVertex, entityHasImage);
            }
        }

        for (Edge edge : vertex.getEdges(Direction.BOTH, artifactContainsImageOfEntityIri, authorizations)) {
            for (Property rowKeyProperty : vertex.getProperties(LumifyProperties.ROW_KEY.getPropertyName())) {
                String multiValueKey = rowKeyProperty.getValue().toString();
                if (edge.getVertexId(Direction.IN).equals(vertex.getId())) {
                    Vertex outVertex = edge.getVertex(Direction.OUT, authorizations);
                    // remove property
                    LumifyProperties.DETECTED_OBJECT.removeProperty(outVertex, multiValueKey, authorizations);
                    graph.removeEdge(edge, authorizations);
                    auditRepository.auditRelationship(AuditAction.DELETE, outVertex, vertex, edge, "", "", user, lumifyVisibility.getVisibility());
                    this.workQueueRepository.pushEdgeDeletion(edge);
                    this.workQueueRepository.pushGraphPropertyQueue(outVertex, multiValueKey,
                            LumifyProperties.DETECTED_OBJECT.getPropertyName(), workspaceId, visibilityJson.getSource());
                }
            }
        }

        for (Vertex termMention : termMentionRepository.findResolvedTo(vertex.getId(), authorizations)) {
            workspaceHelper.unresolveTerm(vertex, termMention, lumifyVisibility, user, authorizations);
            JSONObject result = new JSONObject();
            result.put("success", true);
            unresolved.put(result);
        }

        Authorizations systemAuthorization = userRepository.getAuthorizations(user, WorkspaceRepository.VISIBILITY_STRING, workspaceId);
        Vertex workspaceVertex = graph.getVertex(workspaceId, systemAuthorization);
        for (Edge edge : workspaceVertex.getEdges(vertex, Direction.BOTH, systemAuthorization)) {
            graph.removeEdge(edge, systemAuthorization);
        }

        graph.removeVertex(vertex, authorizations);
        graph.flush();
        return unresolved;
    }
}
