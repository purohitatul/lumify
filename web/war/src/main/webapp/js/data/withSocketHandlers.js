define([], function() {
    'use strict';

    return withSocketHandlers;

    function withSocketHandlers() {

        this.after('initialize', function() {
            this.on('socketMessage', this.onSocketMessage);
        });

        this.onSocketMessage = function(evt, message) {
            var self = this,
                updated = null;

            switch (message.type) {
                case 'propertiesChange':

                    if (message.data && message.data.vertex && !message.data.vertex.sourceVertexId) {
                        if (self.cachedVertices[message.data.vertex.id]) {
                            updated = self.updateCacheWithVertex(message.data.vertex, { returnNullIfNotChanged: true });
                            if (updated) {
                                self.trigger('verticesUpdated', {
                                    vertices: [updated],
                                    options: {
                                        originalEvent: message.type,
                                        originalData: message.data
                                    }
                                });
                            }
                        }
                    } else if (message.data && message.data.edge) {
                        var label = message.data.edge.label,
                            vertices = _.compact([
                                self.cachedVertices[message.data.edge.sourceVertexId],
                                self.cachedVertices[message.data.edge.destVertexId]
                            ]);

                        vertices.forEach(function(vertex) {
                            if (!vertex.edgeLabels) {
                                vertex.edgeLabels = [];
                            }

                            if (vertex.edgeLabels.indexOf(label) === -1) {
                                vertex.edgeLabels.push(label);
                            }
                        });

                        if (vertices.length) {
                            self.trigger('verticesUpdated', {
                                vertices: vertices,
                                options: {
                                    originalEvent: message.type
                                }
                            });
                            if (vertices.length === 2) {
                                self.trigger('refreshRelationships');
                            }
                        }

                        self.trigger('edgesUpdated', {
                            edges: [message.data.edge],
                            options: {
                                originalData: message.data
                            }
                        })
                    }
                    break;
                case 'entityImageUpdated':
                    if (message.data && message.data.graphVertexId) {
                        updated = self.updateCacheWithVertex(message.data.vertex, { returnNullIfNotChanged: true });
                        if (updated) {
                            self.trigger('verticesUpdated', { vertices: [updated] });
                            self.trigger('iconUpdated', { src: null });
                        }
                    } else console.warn('entityImageUpdated event received with no graphVertexId', message);
                    break;

                case 'textUpdated':
                    if (message.data && message.data.graphVertexId) {
                        self.trigger('textUpdated', { vertexId: message.data.graphVertexId })
                    } else console.warn('textUpdated event received with no graphVertexId', message);
                    break;

                case 'edgeDeletion':
                    if (_.findWhere(self.selectedEdges, { id: message.data.edgeId })) {
                        self.trigger('selectObjects');
                    }
                    self.trigger('edgesDeleted', { edgeId: message.data.edgeId});
                    break;

                case 'verticesDeleted':
                    if (_.some(self.selectedVertices, function(vertex) {
                            return ~message.data.vertexIds.indexOf(vertex.id);
                        })) {
                        self.trigger('selectObjects');
                    }
                    self.trigger('verticesDeleted', {
                        vertices: message.data.vertexIds.map(function(vId) {
                            return { id: vId };
                        })
                    });
                    break;

                case 'workspaceChange':
                    self.trigger('workspaceUpdated', {
                        workspace: message.data
                    });
                    break;

                case 'workspaceDelete':
                    self.trigger('workspaceDeleted', {
                        workspaceId: message.workspaceId
                    });
                    break;

                case 'userStatusChange':
                    if (message.data && message.data.status && message.data.status === "OFFLINE"
                        && message.data.id && message.data.id === currentUser.id) {
                        $(document).trigger('logout', {  message: i18n('lumify.session.expired') });
                    }
                    break;
            }
        };
    }
});
