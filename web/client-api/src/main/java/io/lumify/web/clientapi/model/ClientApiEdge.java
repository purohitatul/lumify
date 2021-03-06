package io.lumify.web.clientapi.model;

public class ClientApiEdge extends ClientApiElement {
    private String label;
    private String sourceVertexId;
    private String destVertexId;

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public String getSourceVertexId() {
        return sourceVertexId;
    }

    public void setSourceVertexId(String sourceVertexId) {
        this.sourceVertexId = sourceVertexId;
    }

    public String getDestVertexId() {
        return destVertexId;
    }

    public void setDestVertexId(String destVertexId) {
        this.destVertexId = destVertexId;
    }

    @Override
    public String getType() {
        return "edge";
    }
}
