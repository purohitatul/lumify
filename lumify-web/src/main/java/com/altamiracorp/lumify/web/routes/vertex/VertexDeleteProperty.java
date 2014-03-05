package com.altamiracorp.lumify.web.routes.vertex;

import com.altamiracorp.lumify.core.config.Configuration;
import com.altamiracorp.lumify.core.model.PropertyJustificationMetadata;
import com.altamiracorp.lumify.core.model.audit.AuditAction;
import com.altamiracorp.lumify.core.model.audit.AuditRepository;
import com.altamiracorp.lumify.core.model.user.UserRepository;
import com.altamiracorp.lumify.core.security.LumifyVisibility;
import com.altamiracorp.lumify.core.security.VisibilityTranslator;
import com.altamiracorp.lumify.core.user.User;
import com.altamiracorp.lumify.core.util.GraphUtil;
import com.altamiracorp.lumify.web.BaseRequestHandler;
import com.altamiracorp.miniweb.HandlerChain;
import com.altamiracorp.securegraph.Authorizations;
import com.altamiracorp.securegraph.Graph;
import com.altamiracorp.securegraph.Property;
import com.altamiracorp.securegraph.Vertex;
import com.google.inject.Inject;
import org.json.JSONObject;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.util.HashMap;
import java.util.Map;

public class VertexDeleteProperty extends BaseRequestHandler {
    private final Graph graph;
    private final AuditRepository auditRepository;
    private final VisibilityTranslator visibilityTranslator;

    @Inject
    public VertexDeleteProperty(
            final Graph graph,
            final AuditRepository auditRepository,
            final UserRepository userRepository,
            final Configuration configuration,
            final VisibilityTranslator visibilityTranslator) {
        super(userRepository, configuration);
        this.graph = graph;
        this.auditRepository = auditRepository;
        this.visibilityTranslator = visibilityTranslator;
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, HandlerChain chain) throws Exception {
        final String graphVertexId = getAttributeString(request, "graphVertexId");
        final String propertyName = getRequiredParameter(request, "propertyName");
        final String justificationText = getRequiredParameter(request, "justificationString");

        User user = getUser(request);
        Authorizations authorizations = getAuthorizations(request, user);
        String workspaceId = getWorkspaceId(request);

        Vertex graphVertex = graph.getVertex(graphVertexId, authorizations);
        Property property = graphVertex.getProperty(propertyName);

        String visibilityJsonString = (String) property.getMetadata().get(GraphUtil.VISIBILITY_JSON_PROPERTY);
        JSONObject visibilityJson = GraphUtil.updateVisibilityJsonRemoveFromWorkspace(visibilityJsonString, workspaceId);
        LumifyVisibility lumifyVisibility = visibilityTranslator.toVisibility(visibilityJson);
        graphVertex.prepareMutation()
                .alterPropertyVisibility(property.getKey(), property.getName(), lumifyVisibility.getVisibility())
                .alterPropertyMetadata(property.getKey(), property.getName(), GraphUtil.VISIBILITY_JSON_PROPERTY, visibilityJson.toString())
                .save();

        graph.flush();

        Map<String, Object> metadata = new HashMap<String, Object>();
        metadata.put(PropertyJustificationMetadata.PROPERTY_JUSTIFICATION, new PropertyJustificationMetadata(justificationText));

        auditRepository.auditEntityProperty(AuditAction.DELETE, graphVertex, propertyName, property.getValue(), null, "", "", metadata, user, lumifyVisibility.getVisibility());

        // TODO: broadcast property delete

        Iterable<com.altamiracorp.securegraph.Property> properties = graphVertex.getProperties();
        JSONObject propertiesJson = GraphUtil.toJsonProperties(properties);
        JSONObject json = new JSONObject();
        json.put("properties", propertiesJson);
        json.put("deletedProperty", propertyName);
        json.put("vertex", GraphUtil.toJson(graphVertex));
        respondWithJson(response, json);
    }
}
