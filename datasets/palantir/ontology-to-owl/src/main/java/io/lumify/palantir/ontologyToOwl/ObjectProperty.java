package io.lumify.palantir.ontologyToOwl;

import org.w3c.dom.Element;

import java.util.HashSet;
import java.util.Set;

public class ObjectProperty implements OwlElement {
    private final Element objectPropertyElement;
    private final Set<String> domainUris = new HashSet<String>();
    private final Set<String> rangeUris = new HashSet<String>();
    private String edgeIconUri;
    private String infoIconUri;

    public ObjectProperty(Element objectPropertyElement) {
        this.objectPropertyElement = objectPropertyElement;
    }

    public void addDomain(String domainUri) {
        domainUris.add(domainUri);
    }

    public void addRange(String rangeUri) {
        rangeUris.add(rangeUri);
    }

    public Element getElement() {
        return objectPropertyElement;
    }

    public Set<String> getDomainUris() {
        return domainUris;
    }

    public Set<String> getRangeUris() {
        return rangeUris;
    }

    public void setEdgeIconUri(String edgeIconUri) {
        this.edgeIconUri = edgeIconUri;
    }

    public String getEdgeIconUri() {
        return edgeIconUri;
    }

    public void setInfoIconUri(String infoIconUri) {
        this.infoIconUri = infoIconUri;
    }

    public String getInfoIconUri() {
        return infoIconUri;
    }
}
