package io.lumify.web.routes.vertex;

import com.google.inject.Inject;
import io.lumify.core.config.Configuration;
import io.lumify.core.exception.LumifyException;
import io.lumify.core.model.user.UserRepository;
import io.lumify.core.model.workspace.WorkspaceRepository;
import io.lumify.core.user.User;
import io.lumify.core.util.GraphUtil;
import io.lumify.core.util.LumifyLogger;
import io.lumify.core.util.LumifyLoggerFactory;
import io.lumify.miniweb.HandlerChain;
import io.lumify.web.BaseRequestHandler;
import io.lumify.web.clientapi.model.SandboxStatus;
import io.lumify.web.routes.workspace.WorkspaceHelper;
import org.securegraph.Authorizations;
import org.securegraph.Edge;
import org.securegraph.Graph;
import org.securegraph.Vertex;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class VertexRemoveEdge extends BaseRequestHandler {
    private static final LumifyLogger LOGGER = LumifyLoggerFactory.getLogger(VertexRemoveEdge.class);
    private final Graph graph;
    private final WorkspaceHelper workspaceHelper;
    private final String entityHasImageIri;

    @Inject
    public VertexRemoveEdge(
            final Graph graph,
            final WorkspaceHelper workspaceHelper,
            final UserRepository userRepository,
            final WorkspaceRepository workspaceRepository,
            final Configuration configuration) {
        super(userRepository, workspaceRepository, configuration);
        this.graph = graph;
        this.workspaceHelper = workspaceHelper;

        this.entityHasImageIri = this.getConfiguration().get(Configuration.ONTOLOGY_IRI_ENTITY_HAS_IMAGE);
        if (this.entityHasImageIri == null) {
            throw new LumifyException("Could not find configuration for " + Configuration.ONTOLOGY_IRI_ENTITY_HAS_IMAGE);
        }
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, HandlerChain chain) throws Exception {
        final String sourceId = getRequiredParameter(request, "sourceId");
        final String targetId = getRequiredParameter(request, "targetId");
        final String edgeId = getRequiredParameter(request, "edgeId");
        String workspaceId = getActiveWorkspaceId(request);

        User user = getUser(request);
        Authorizations authorizations = getAuthorizations(request, user);

        Vertex sourceVertex = graph.getVertex(sourceId, authorizations);
        Vertex destVertex = graph.getVertex(targetId, authorizations);
        Edge edge = graph.getEdge(edgeId, authorizations);

        SandboxStatus sandboxStatuses = GraphUtil.getSandboxStatus(edge, workspaceId);

        if (sandboxStatuses == SandboxStatus.PUBLIC) {
            LOGGER.warn("Could not find non-public edge: %s", edgeId);
            chain.next(request, response);
            return;
        }

        workspaceHelper.deleteEdge(edge, sourceVertex, destVertex, entityHasImageIri, user, authorizations);
        respondWithSuccessJson(response);
    }
}
