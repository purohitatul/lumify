
define([
    'flight/lib/component',
    'flight/lib/registry',
    'data/withVertexCache',
    'data/withAjaxFilters',
    'data/withServiceHandlers',
    'data/withSocketHandlers',
    'data/withPendingChanges',
    'util/withAsyncQueue',
    'util/withDocumentUnloadHandlers',
    'util/keyboard',
    'service/workspace',
    'service/vertex',
    'service/ontology',
    'service/config',
    'service/user',
    'util/deferredImage',
    'util/undoManager',
    'util/clipboardManager',
    'util/privileges',
    'util/vertex/formatters'
], function(
    // Flight
    defineComponent, registry,
    // Mixins
    withVertexCache, withAjaxFilters, withServiceHandlers, withSocketHandlers,
    withPendingChanges, withAsyncQueue, withDocumentUnloadHandlers,
    // Service
    Keyboard, WorkspaceService, VertexService, OntologyService, ConfigService, UserService,

    deferredImage, undoManager, ClipboardManager, Privileges, F) {
    'use strict';

    var WORKSPACE_SAVE_DELAY = 500,
        RELOAD_RELATIONSHIPS_DELAY = 250,
        ADD_VERTICES_DELAY = 100,
        DataComponent = defineComponent(Data,
                                        withAsyncQueue,
                                        withVertexCache,
                                        withAjaxFilters,
                                        withServiceHandlers,
                                        withSocketHandlers,
                                        withDocumentUnloadHandlers,
                                        withPendingChanges);

    return initializeData();

    function initializeData() {
        DataComponent.attachTo(document);

        var instanceInfo = _.find(registry.findInstanceInfoByNode(document), function(info) {
            return info.instance.constructor === DataComponent;
        });

        if (instanceInfo) {
            return instanceInfo.instance;
        } else {
            throw 'Unable to find data instance';
        }
    }

    function resetWorkspace(vertex) {
        vertex.workspace = {};
    }

    function Data() {

        this.workspaceService = new WorkspaceService();
        this.vertexService = new VertexService();
        this.ontologyService = new OntologyService();
        this.configService = new ConfigService();
        this.userService = new UserService();
        this.selectedVertices = [];
        this.selectedVertexIds = [];
        this.workspaceId = null;

        this.defaultAttrs({
            droppableSelector: 'body'
        });

        this.after('teardown', function() {
            _.delay(function() {
                DataComponent.teardownAll();
            });
        });

        this.after('initialize', function() {
            var self = this;

            this.newlyAddedIds = [];
            this.setupAsyncQueue('workspace');
            this.setupAsyncQueue('relationships');
            this.setupAsyncQueue('socketSubscribe');
            this.setupDroppable();

            this.onSaveWorkspaceInternal = _.debounce(this.onSaveWorkspaceInternal.bind(this), WORKSPACE_SAVE_DELAY);
            this.refreshRelationships = _.debounce(this.refreshRelationships.bind(this), RELOAD_RELATIONSHIPS_DELAY);

            this.cachedConceptsDeferred = $.Deferred();
            this.ontologyService.concepts().done(function(concepts) {
                self.cachedConcepts = concepts;
                self.cachedConceptsDeferred.resolve(concepts);
                self.precacheIcons(concepts);
            })

            ClipboardManager.attachTo(this.node);
            Keyboard.attachTo(this.node);

            // Set Current WorkspaceId header on all ajax requests
            $.ajaxPrefilter(function(options, originalOptions, jqXHR) {
                var requestContainsWorkspaceParameter =
                    originalOptions &&
                    originalOptions.data &&
                    !_.isUndefined(originalOptions.data.workspaceId);

                if (!options.headers) options.headers = {};
                if (self.workspaceId && !requestContainsWorkspaceParameter) {
                    options.headers['Lumify-Workspace-Id'] = self.workspaceId;
                }
            });

            // Vertices
            this.on('addVertices', this.onAddVertices);
            this.on('updateVertices', this.onUpdateVertices);
            this.on('deleteVertices', this.onDeleteVertices);
            this.on('verticesDeleted', this.onVerticesDeleted);
            this.on('refreshRelationships', this.refreshRelationships);
            this.on('selectObjects', this.onSelectObjects);
            this.on('clipboardPaste', this.onClipboardPaste);
            this.on('clipboardCut', this.onClipboardCut);
            this.on('deleteEdges', this.onDeleteEdges);
            this.on('willLogout', this.willLogout);
            this.on('filterWorkspace', this.onFilterWorkspace);
            this.on('clearWorkspaceFilter', this.onClearWorkspaceFilter);
            this.on('toggleWorkspaceFilter', this.onToggleWorkspaceFilter);

            // Workspaces
            this.on('saveWorkspace', this.onSaveWorkspace);
            this.on('switchWorkspace', this.onSwitchWorkspace);
            this.on('workspaceDeleted', this.onWorkspaceDeleted);
            this.on('workspaceCopied', this.onWorkspaceCopied);
            this.on('reloadWorkspace', this.onReloadWorkspace);
            this.on('requestLoadWorkspace', this.onRequestLoadWorkspace);

            // Vertices
            this.on('searchTitle', this.onSearchTitle);
            this.on('searchRelated', this.onSearchRelated);
            this.on('addRelatedItems', this.onAddRelatedItems);

            // Service requests
            this.on('requestUsersForChat', this.onRequestUsersForChat);
            this.on('requestHistogramValues', this.onRequestHistogramValues);

            this.on('copydocumenttext', this.onDocumentTextCopy);

            this.on('selectAll', this.onSelectAll);
            this.on('deleteSelected', this.onDelete);

            this.on('applicationReady', function() {
                self.cachedConceptsDeferred.done(function() {
                    self.onApplicationReady();
                });
            });
        });

        this.onApplicationReady = function() {
            var self = this;

            this.trigger(document, 'registerKeyboardShortcuts', {
                scope: ['graph.help.scope', 'map.help.scope'].map(i18n),
                shortcuts: {
                    'meta-a': { fire: 'selectAll', desc: i18n('lumify.help.select_all') },
                    'delete': {
                        fire: 'deleteSelected',
                        desc: i18n('lumify.help.delete')
                    },
                }
            });

            this.trigger(document, 'registerKeyboardShortcuts', {
                scope: ['graph.help.scope', 'map.help.scope', 'search.help.scope'].map(i18n),
                shortcuts: {
                    'alt-r': { fire: 'addRelatedItems', desc: i18n('lumify.help.add_related') },
                    'alt-t': { fire: 'searchTitle', desc: i18n('lumify.help.search_title') },
                    'alt-s': { fire: 'searchRelated', desc: i18n('lumify.help.search_related') },
                }
            });

            this.workspaceService.subscribe({
                onMessage: function(err, message) {
                    if (err) {
                        console.error('Error', err);
                        return self.trigger(document, 'error', { message: err.toString() });
                    }
                    if (message) {
                        self.trigger(document, 'socketMessage', message);
                    }
                },
                onOpen: function(response) {
                    self.trigger(document, 'subscribeSocketOpened');
                    self.socketSubscribeMarkReady(response);
                }
            });
        };

        this.onRequestHistogramValues = function(event, data) {
            this.trigger(event.target, 'histogramValuesRequested', {
                values: _.chain(this.verticesInWorkspace())
                    .map(function(v) {
                        var props = F.vertex.props(v, data.property.title);
                        return props.map(F.vertex.prop);
                    })
                    .flatten(true)
                    .compact()
                    .value()
            })
        };

        this.onRequestUsersForChat = function(event, data) {
            var self = this;

            this.workspaceReady()
                .done(function(workspace) {
                    $.when(
                        self.userService.getCurrentUsers(workspace.workspaceId),
                        self.workspaceService.list()
                    ).done(function(usersResponse, workspacesResponse) {
                        var users = usersResponse[0].users,
                            workspaces = workspacesResponse[0].workspaces;

                        self.trigger(event.target, 'usersForChat', {
                            workspace: workspace,
                            users: users,
                            workspaces: workspaces
                        });
                    });
                });
        };

        this.onSearchTitle = function(event, data) {
            var self = this,
                vertexId = data.vertexId || (
                    this.selectedVertexIds.length === 1 && this.selectedVertexIds[0]
                );

            if (vertexId) {
                this.getVertexTitle(vertexId)
                    .done(function(title) {
                        self.trigger('searchByEntity', { query: title });
                    });
            }
        };

        this.onSearchRelated = function(event, data) {
            var vertexId = data.vertexId || (
                this.selectedVertexIds.length === 1 && this.selectedVertexIds[0]
            );

            if (vertexId) {
                this.trigger('searchByRelatedEntity', { vertexId: vertexId });
            }
        };

        this.onAddRelatedItems = function(event, data) {
            var self = this;

            if (!data || _.isUndefined(data.vertexId)) {
                if (this.selectedVertexIds.length === 1) {
                    data = { vertexId: this.selectedVertexIds[0] };
                } else {
                    return;
                }
            }

            require(['util/popovers/addRelated/addRelated'], function(RP) {
                var vertexId = data.vertexId;

                RP.teardownAll();

                self.getVertexTitle(vertexId).done(function(title) {
                    RP.attachTo(event.target, {
                        title: title,
                        relatedToVertexId: vertexId,
                        anchorTo: {
                            vertexId: vertexId
                        }
                    });
                });
            });
        };

        var copiedDocumentText,
            copiedDocumentTextStorageKey = 'SESSION_copiedDocumentText';
        this.onDocumentTextCopy = function(event, data) {
            copiedDocumentText = data;
            if (window.localStorage) {
                try {
                    localStorage.setItem(copiedDocumentTextStorageKey, JSON.stringify(data));
                } catch(e) {
                    console.warn('Unable to set localStorage item');
                }
            }
        };

        this.copiedDocumentText = function() {
            var text;
            if (window.localStorage) {
                text = localStorage.getItem(copiedDocumentTextStorageKey);
                if (text) {
                    text = JSON.parse(text);
                }
            }

            if (text === null || _.isUndefined(text)) {
                return copiedDocumentText;
            }

            return text;
        };

        this.onSelectAll = function() {
            this.trigger('selectObjects', { vertices: this.verticesInWorkspace() });
        };

        this.onDelete = function(event, data) {
            if (!this.workspaceEditable) {
                return;
            }

            if (data && data.vertexId) {
                this.trigger('deleteVertices', {
                    vertices: this.vertices([data.vertexId])
                });
            } else {
                if (this.selectedVertices.length) {
                    this.trigger('deleteVertices', { vertices: this.vertices(this.selectedVertices)})
                } else if (this.selectedEdges && this.selectedEdges.length && Privileges.canEDIT) {
                    this.trigger('deleteEdges', { edges: this.selectedEdges});
                }
            }
        };

        this.throttledUpdatesByVertex = {};
        this.onSaveWorkspace = function(evt, data) {
            var self = this,
                updates = this.throttledUpdatesByVertex,
                stateByVertex = {},
                vertexToEntityUpdate = function(vertex, updateType) {
                    if (~updateType.indexOf('Deletes')) {
                        return vertex.id;
                    }

                    return {
                        vertexId: vertex.id,
                        graphPosition: vertex.workspace.graphPosition ? {
                            x: Math.floor(vertex.workspace.graphPosition.x),
                            y: Math.floor(vertex.workspace.graphPosition.y)
                        } : undefined
                    };
                },
                uniqueVertices = function(v) {
                    return v.vertexId;
                };

            if (data.adding) {
                this.newlyAddedIds = this.newlyAddedIds.concat(_.pluck(data.entityUpdates, 'id'));
            }

            _.keys(data).forEach(function(key) {
                if (_.isArray(data[key])) {
                    data[key].forEach(function(vertex) {
                        var json = vertexToEntityUpdate(vertex, key);
                        stateByVertex[vertex.id] = json;

                        updates[vertex.id] = {
                            updateType: key,
                            updateJson: json
                        }
                    });
                }
            });

            if (_.isEqual(
                stateByVertex,
                _.pick.apply(_, [this.currentVertexState].concat(_.keys(stateByVertex)))
            )) {
                return;
            }
            $.extend(true, this.currentVertexState, stateByVertex);

            this.refreshRelationships();
            this.onSaveWorkspaceInternal();
        };

        this.onSaveWorkspaceInternal = function() {
            var self = this;

            this.workspaceReady(function(ws) {
                this.trigger('workspaceSaving', ws);

                var updateJson = {}, updates = this.throttledUpdatesByVertex;
                _.keys(updates).forEach(function(vertexId) {
                    var update = updates[vertexId],
                        updateType = update.updateType;
                    (updateJson[updateType] || (updateJson[updateType] = [])).push(update.updateJson);
                });
                this.throttledUpdatesByVertex = {};

                this.workspaceService.save(this.workspaceId, updateJson).done(function(data) {
                    self.newlyAddedIds.length = 0;
                    self.trigger('refreshRelationships');
                    self.trigger('workspaceSaved', ws);
                    _.values(self.workspaceVertices).forEach(function(wv) {
                        delete wv.dropPosition;
                    });
                });
            });
        };

        this.refreshRelationships = function() {
            var self = this;

            if (this.verticesInWorkspace().length < 2) {
                return;
            }

            this.relationshipsUnload();

            this.workspaceService.getEdges(this.workspaceId, this.newlyAddedIds)
                .done(function(relationships) {
                    self.relationshipsMarkReady(relationships.edges);
                    self.trigger('relationshipsLoaded', { relationships: relationships.edges });
                });
        };

        this.onDeleteEdges = function(evt, data) {
            if (!data.edges || !data.edges.length) {
                return console.error('Invalid event data to delete edge', data);
            }

            if (Privileges.canEDIT && _.every(data.edges, function(e) {
                return e.diffType !== 'PUBLIC';
            })) {

                var self = this,
                    edge = data.edges[0];
                this.vertexService.deleteEdge(
                    edge.properties.source,
                    edge.properties.target,
                    edge.properties.relationshipType,
                    edge.id).done(function() {
                        if (_.findWhere(self.selectedEdges, { id: edge.id })) {
                            self.trigger('selectObjects');
                        }
                        self.trigger('edgesDeleted', { edgeId: edge.id });
                    });
            }

        };

        this.onAddVertices = function(evt, data) {
            this.workspaceReady(function(ws) {
                if (!ws.editable && !data.remoteEvent) return;

                var self = this,
                    added = [],
                    existing = [],
                    addingVerticesRelatedTo = !!(data.options && data.options.addingVerticesRelatedTo),
                    addingVerticesFileDrop = !!(data.options && data.options.fileDropPosition),
                    shouldBeSelected = (addingVerticesFileDrop || addingVerticesRelatedTo ||
                                        (data.options && data.options.shouldBeSelected)),
                    // Check if vertices are missing properties (from search results)
                    needsRefreshing = data.vertices.filter(function(v) {
                        var cached = self.vertex(v.id);
                        if (!cached) {
                            return _.keys(v.properties || {}).length === 0;
                        }
                        return false;
                    }),
                    passedWorkspace = {};

                data.vertices.forEach(function(v) {
                    v.workspace = v.workspace || {};
                    v.workspace.selected = shouldBeSelected;
                    passedWorkspace[v.id] = self.copy(v.workspace);
                });

                var deferred = $.Deferred();
                if (needsRefreshing.length) {
                    this.vertexService.getMultiple(_.pluck(needsRefreshing, 'id')).done(function() {
                        deferred.resolve(data.vertices);
                    });
                } else deferred.resolve(data.vertices);

                deferred.done(function(vertices) {
                    vertices = self.vertices(vertices);

                    vertices.forEach(function(vertex) {
                        if (passedWorkspace[vertex.id]) {
                            vertex.workspace = $.extend(vertex.workspace, passedWorkspace[vertex.id]);
                        }

                        var inWorkspace = self.workspaceVertices[vertex.id],
                            cache = self.updateCacheWithVertex(vertex);

                        self.workspaceVertices[vertex.id] = cache.workspace;

                        if (inWorkspace) {
                            existing.push(cache);
                        } else {
                            added.push(cache);
                        }
                    });

                    if (existing.length) self.trigger('existingVerticesAdded', { vertices: existing });

                    if (added.length === 0) {
                        var message = i18n('lumify.no_new_vertices_added');
                        self.trigger('displayInformation', { message: message });
                        return;
                    }

                    if (!data.noUndo) {
                        var dataClone = JSON.parse(JSON.stringify(data));
                        dataClone.noUndo = true;
                        undoManager.performedAction('Add ' + dataClone.vertices.length + ' vertices', {
                            undo: function() {
                                self.trigger('deleteVertices', dataClone);
                            },
                            redo: function() {
                                self.trigger('addVertices', dataClone);
                            }
                        });
                    }

                    if (!data.remoteEvent) self.trigger('saveWorkspace', { entityUpdates: added, adding: true });
                    if (added.length) {
                        if (shouldBeSelected) {
                            self.trigger('selectObjects');
                        }
                        ws.data.vertices = ws.data.vertices.concat(added);
                        self.trigger('verticesAdded', {
                            vertices: added,
                            remoteEvent: data.remoteEvent,
                            options: data.options || {}
                        });
                        if (shouldBeSelected) {
                            self.trigger('selectObjects', { vertices: added })
                        }
                    }
                });
            });
        };

        this.onUpdateVertices = function(evt, data) {
            var self = this;

            this.workspaceReady(function(ws) {
                var undoData = { noUndo: true, vertices: [] },
                    redoData = { noUndo: true, vertices: [] },
                    shouldSave = false,
                    updated = data.vertices.map(function(vertex) {
                        if (!vertex.id && vertex.graphVertexId) {
                            vertex = {
                                id: vertex.graphVertexId,
                                properties: vertex
                            };
                        }

                        // Only save if workspace updated
                        if (self.workspaceVertices[vertex.id] && vertex.workspace) {
                            shouldSave = true;
                        }

                        if (shouldSave) undoData.vertices.push(self.workspaceOnlyVertexCopy({id: vertex.id}));
                        var cache = self.updateCacheWithVertex(vertex);
                        if (shouldSave) redoData.vertices.push(self.workspaceOnlyVertexCopy(cache));
                        return cache;
                    });

                if (!data.noUndo && undoData.vertices.length) {
                    undoManager.performedAction('Update ' + undoData.vertices.length + ' vertices', {
                        undo: function() {
                            self.trigger('updateVertices', undoData);
                        },
                        redo: function() {
                            self.trigger('updateVertices', redoData);
                        }
                    });
                }

                if (shouldSave && !data.remoteEvent) {
                    this.trigger('saveWorkspace', { entityUpdates: updated });
                }
                if (updated.length) {
                    this.trigger('verticesUpdated', {
                        vertices: updated,
                        remoteEvent: data.remoteEvent
                    });
                }
            });
        };

        this.getVerticesFromClipboardData = function(data) {
            if (data) {
                var p = F.vertexUrl.parametersInUrl(data);
                if (p && p.vertexIds) {
                    return p.vertexIds;
                }
            }

            return [];
        };

        this.formatVertexAction = function(action, vertices) {
            var len = vertices.length;
            return i18n('vertex.clipboard.action.' + (
                len === 1 ? 'one' : 'some'
            ), i18n('vertex.clipboard.action' + action.toLowerCase()), len);
        };

        this.onClipboardCut = function(evt, data) {
            var self = this,
                vertexIds = this.getVerticesFromClipboardData(data.data).filter(function(vId) {
                    // Only cut from those in workspace
                    return self.workspaceVertices[vId];
                }),
                len = vertexIds.length;

            if (len) {
                this.trigger('deleteVertices', { vertices: this.vertices(vertexIds) });
                this.trigger('displayInformation', { message: this.formatVertexAction('Cut', vertexIds)});
            }
        };

        this.onClipboardPaste = function(evt, data) {
            var self = this,
                vertexIds = this.getVerticesFromClipboardData(data.data).filter(function(vId) {
                    // Only allow paste from vertices not in workspace
                    return !self.workspaceVertices[vId];
                }),
                len = vertexIds.length,
                plural = len === 1 ? 'vertex' : 'vertices';

            if (len) {
                this.trigger('displayInformation', { message: this.formatVertexAction('Pasting', vertexIds) + '...' });
                this.vertexService.getMultiple(vertexIds).done(function(data) {
                    if (data.vertices.length !== vertexIds.length) {
                        self.trigger('displayInformation', {
                            message: i18n('vertex.clipboard.private.vertices.' + (
                                (vertexIds.length - data.vertices.length) === 1 ? 'one' : 'some'
                            ), (vertexIds.length - data.vertices.length))
                        });
                    } else {
                        self.trigger('displayInformation', {
                            message: self.formatVertexAction('Pasted', vertexIds)
                        });
                    }
                    self.trigger('addVertices', {
                        vertices: data.vertices,
                        options: {
                            shouldBeSelected: true
                        }
                    });
                });
            }
        };

        this.onSelectObjects = function(evt, data) {
            if (data && data.remoteEvent) return;

            var self = this,
                vertices = data && data.vertices || [],
                needsLoading = _.chain(vertices)
                    .filter(function(v) {
                        return _.isEqual(v, { id: v.id }) && _.isUndefined(self.vertex(v.id));
                    })
                    .value(),
                deferred = $.Deferred();

            if (needsLoading.length) {
                this.vertexService.getMultiple(_.pluck(needsLoading, 'id'))
                    .done(function() {
                        deferred.resolve();
                    });
            } else {
                deferred.resolve();
            }

            deferred.done(function() {
                var selectedIds = _.pluck(vertices, 'id'),
                    loadedVertices = vertices.map(function(v) {
                        return self.vertex(v.id) || v;
                    }),
                    selected = _.groupBy(loadedVertices, function(v) {
                        return v.concept ? 'vertices' : 'edges';
                    });

                if ((!data || !data.options || data.options.forceSelectEvenIfSame !== true) &&
                    _.isArray(self.previousSelection) &&
                    _.isArray(selectedIds) &&
                    _.isEqual(self.previousSelection, selectedIds)) {
                    return;
                }
                self.previousSelection = selectedIds;

                selected.vertices = selected.vertices || [];
                selected.edges = selected.edges || [];

                if (window.DEBUG) {
                    DEBUG.selectedObjects = selected;
                }

                if (selected.vertices.length) {
                    self.trigger('clipboardSet', {
                        text: F.vertexUrl.url(selected.vertices, self.workspaceId)
                    });
                } else {
                    self.trigger('clipboardClear');
                }

                self.selectedVertices = selected.vertices;
                self.selectedVertexIds = _.pluck(selected.vertices, 'id');
                self.selectedEdges = selected.edges;

                _.keys(self.workspaceVertices).forEach(function(id) {
                    var info = self.workspaceVertices[id];
                    info.selected = selectedIds.indexOf(id) >= 0;
                });

                $.extend(selected, _.pick(data || {}, 'focus'));

                self.trigger('objectsSelected', selected);
            })
        };

        this.onVerticesDeleted = function(evt, data) {
            var self = this,
                softDeletion = data.options && data.options.soft === true;

            if (!softDeletion && data && data.vertices) {
                data.vertices.forEach(function(vertex) {
                    var workspaceInfo = self.workspaceVertices[vertex.id];
                    if (workspaceInfo) {
                        delete self.workspaceVertices[vertex.id];
                    }
                    var cache = self.vertex(vertex.id);
                    if (cache) {
                        cache.workspace = {};
                    }
                });
            }
        };

        this.onDeleteVertices = function(evt, data) {
            var self = this;
            this.workspaceReady(function(ws) {
                if (!ws.editable && !data.remoteEvent) return;

                var toDelete = [],
                    undoDelete = [],
                    redoDelete = [];
                data.vertices.forEach(function(deletedVertex) {
                    var workspaceInfo = self.workspaceVertices[deletedVertex.id];
                    if (workspaceInfo) {
                        redoDelete.push(self.workspaceOnlyVertexCopy(deletedVertex.id));
                        undoDelete.push(self.copy(self.vertex(deletedVertex.id)));
                        toDelete.push(self.vertex(deletedVertex.id));

                    }
                });

                if (!data.noUndo && undoDelete.length) {
                    undoManager.performedAction('Delete ' + toDelete.length + ' vertices', {
                        undo: function() {
                            self.trigger(document, 'addVertices', { noUndo: true, vertices: undoDelete });
                        },
                        redo: function() {
                            self.trigger(document, 'deleteVertices', { noUndo: true, vertices: redoDelete });
                        }
                    });
                }

                if (!data.remoteEvent) {
                    this.trigger('saveWorkspace', { entityDeletes: toDelete });
                }
                if (toDelete.length) {
                    var ids = _.pluck(toDelete, 'id');
                    ws.data.vertices = _.filter(ws.data.vertices, function(v) {
                        return ids.indexOf(v.id) === -1;
                    });
                    this.trigger('verticesDeleted', {
                        vertices: toDelete,
                        remoteEvent: data.remoteEvent
                    });
                }
            });
        };

        this.willLogout = function() {
            this.previousSelection = null;
        };

        this.onClearWorkspaceFilter = function() {
            var vertices = this.verticesInWorkspace();
            if (vertices.length) {
                this.trigger('verticesAdded', { vertices: vertices, options: { fit: false } });
            }
            this.currentWorkspaceFilter = null;
        };

        this.onToggleWorkspaceFilter = function(event, data) {
            var enabled = data.enabled;

            if (enabled === this.workspaceFilterEnabled) {
                return;
            }

            if (enabled && this.filteredWorkspaceVertices) {
                this.trigger('verticesDeleted', { vertices: this.filteredWorkspaceVertices, options: { soft: true } });
                this.workspaceFilterEnabled = enabled;
            } else if (!enabled) {
                var vertices = this.verticesInWorkspace();
                if (vertices.length) {
                    this.trigger('verticesAdded', { vertices: vertices, options: { fit: false } });
                }
                this.workspaceFilterEnabled = enabled;
            }
        };

        this.onFilterWorkspace = function(event, data) {
            var self = this,
                query = $.trim((data && data.value) || '').toLowerCase(),
                filters = data.filters,
                conceptFilter = filters && filters.conceptFilter,
                propertyFilters = filters && filters.propertyFilters,
                options = {
                    fit: true,
                    preventShake: true
                },
                async = $.Deferred();

            if (query || conceptFilter || propertyFilters) {
                F.vertex.partitionVertices(this.verticesInWorkspace(), query, conceptFilter, propertyFilters)
                    .done(function(result) {
                        self.filteredWorkspaceVertices = result[1];

                        if (result[1].length) {
                            self.trigger('verticesDeleted', { vertices: result[1], options: { soft: true } });
                        }
                        if (result[0].length) {
                            self.trigger('verticesAdded', { vertices: result[0], options: options });
                        }

                        async.resolve(result[0]);
                    })
            } else {
                var vertices = this.verticesInWorkspace();
                if (vertices.length) {
                    this.trigger('verticesAdded', { vertices: vertices, options: options });
                }
                async.resolve(vertices);
            }

            async.done(function(vertices) {
                self.relationshipsReady(function(relationships) {
                    self.trigger('relationshipsLoaded', { relationships: relationships });
                });
                self.trigger(event.target, 'workspaceFiltered', {
                    hits: vertices && vertices.length,
                    total: _.size(self.workspaceVertices)
                });
            });
        };

        this.loadActiveWorkspace = function() {
            window.workspaceId = this.workspaceId;

            var self = this;
            return self.workspaceService.list()
                .done(function(data) {
                    var workspaces = data.workspaces || [],
                        myWorkspaces = _.filter(workspaces, function(w) {
                            return !w.sharedToUser;
                        });

                    if (myWorkspaces.length === 0) {
                        self.workspaceService.create().done(function(workspace) {
                            self.loadWorkspace(workspace);
                        });
                        return;
                    }

                    for (var i = 0; i < workspaces.length; i++) {
                        if (workspaces[i].active) {
                            return self.loadWorkspace(workspaces[i]);
                        }
                    }

                    self.loadWorkspace(myWorkspaces[0]);
                });
        };

        this.onSwitchWorkspace = function(evt, data) {
            if (!data || !data.workspaceId) {
                this.loadActiveWorkspace();
            } else if (data.workspaceId != this.workspaceId) {
                this.trigger('selectObjects');
                this.loadWorkspace(data.workspaceId);
            }
        };

        this.onWorkspaceDeleted = function(evt, data) {
            if (this.workspaceId === data.workspaceId) {
                this.trigger('selectObjects');
                this.workspaceId = null;
                this.loadActiveWorkspace();
            }
        };

        this.onWorkspaceCopied = function(evt, data) {
            this.workspaceId = data.workspaceId;
            this.loadActiveWorkspace();
        }

        this.onReloadWorkspace = function(evt, data) {
            this.workspaceReady(function(workspace) {
                this.relationshipsReady(function(relationships) {
                    this.trigger('workspaceLoaded', workspace);
                    this.trigger('relationshipsLoaded', { relationships: relationships });
                });
            });
        };

        this.onRequestLoadWorkspace = function(event) {
            this.workspaceReady(function(workspace) {
                this.loadActiveWorkspace();
            });
        };

        this.loadWorkspace = function(workspaceData) {
            var self = this,
                workspaceId = _.isString(workspaceData) ? workspaceData : workspaceData.workspaceId,
                isChanged = self.workspaceId !== workspaceId;

            window.workspaceId = self.workspaceId = workspaceId;

            // Queue up any requests to modify workspace
            self.workspaceUnload();
            self.newlyAddedIds.length = 0;
            self.relationshipsUnload();

            self.socketSubscribeReady()
                .done(function() {
                    $.when(
                        self.getWorkspace(workspaceId)
                            .done(function() {
                                if (isChanged) {
                                    var currentUserId = window.currentUser.id;

                                    self.workspaceService.socketPush({
                                        type: 'changedWorkspace',
                                        permissions: {
                                            users: [currentUserId]
                                        },
                                        data: {
                                            workspaceId: workspaceId,
                                            userId: currentUserId
                                        }
                                    });
                                }
                            }),
                        self.workspaceService.getVertices(workspaceId)
                    ).done(function(workspace, vertexResponse) {
                        self.workspaceEditable = workspace.editable;

                        _.each(_.values(self.cachedVertices), resetWorkspace);
                        self.workspaceVertices = {};
                        self.currentVertexState = _.indexBy(_.keys(workspace.entities).map(function(vId) {
                            return {
                                vertexId: vId,
                                graphPosition: workspace.entities[vId].graphPosition
                            };
                        }), 'vertexId');

                        var serverVertices = vertexResponse[0].vertices,
                            vertices = serverVertices.map(function(vertex) {
                                var workspaceData = {};
                                workspace.vertices.forEach(function(v) {
                                    if (v.vertexId == vertex.id) {
                                        workspaceData = v;
                                    }
                                });
                                delete workspaceData.dropPosition;
                                workspaceData.selected = false;
                                vertex.workspace = workspaceData;

                                var cache = self.updateCacheWithVertex(vertex);
                                self.workspaceVertices[vertex.id] = cache.workspace;

                                workspace.data.verticesById[vertex.id] = cache;
                                return cache;
                            });

                        workspace.data.vertices = vertices.sort(function(a, b) {
                            if (a.workspace.graphPosition && b.workspace.graphPosition) return 0;
                            return a.workspace.graphPosition ? -1 : b.workspace.graphPosition ? 1 : 0;
                        });

                        undoManager.reset();

                        self.refreshRelationships();
                        self.workspaceMarkReady(workspace);
                        self.trigger('workspaceLoaded', workspace);
                    });
                });
        };

        this.getWorkspace = function(id) {
            var self = this,
                deferred = $.Deferred();

            if (id) {
                self.workspaceService.getByRowKey(id)
                    .fail(function(xhr) {
                        if (_.contains([403,404], xhr.status)) {
                            self.trigger('workspaceNotAvailable');
                            self.loadActiveWorkspace();
                        }
                        deferred.reject();
                    })
                    .done(function(workspace) {
                        deferred.resolve(workspace);
                    });
            } else {
                deferred.resolve();
            }
            return deferred.then(function(workspace) {
                    workspace = workspace || {};
                    workspace.data = workspace.data || {};
                    workspace.data.vertices = workspace.data.vertices || [];
                    workspace.data.verticesById = {};

                    return workspace;
                });
        };

        this.getIds = function() {
            return Object.keys(this.workspaceVertices);
        };

        this.setupDroppable = function() {
            var self = this,
                enabled = false,
                droppable = this.select('droppableSelector');

            // Other droppables might be on top of graph, listen to
            // their over/out events and ignore drops if the user hasn't
            // dragged outside of them. Can't use greedy option since they are
            // absolutely positioned
            $(document.body).on('dropover dropout', function(e, ui) {
                var target = $(e.target),
                    appDroppable = target.is(droppable),
                    parentDroppables = target.parents('.ui-droppable');

                if (appDroppable) {
                    // Ignore events from this droppable
                    return;
                }

                // If this droppable has no parent droppables
                if (parentDroppables.length === 1 && parentDroppables.is(droppable)) {
                    enabled = e.type === 'dropout';
                }
            });

            droppable.droppable({
                tolerance: 'pointer',
                accept: function(item) {
                    return true;
                },
                over: function(event, ui) {
                    var draggable = ui.draggable,
                        start = true,
                        graphVisible = $('.graph-pane-2d').is('.visible'),
                        dashboardVisible = $('.dashboard-pane').is('.visible'),
                        vertices,
                        wrapper = $('.draggable-wrapper');

                    // Prevent map from swallowing mousemove events by adding
                    // this transparent full screen div
                    if (wrapper.length === 0) {
                        wrapper = $('<div class="draggable-wrapper"/>').appendTo(document.body);
                    }

                    draggable.off('drag.droppable-tracking');
                    draggable.on('drag.droppable-tracking', function(event, draggableUI) {
                        if (!vertices) {
                            vertices = verticesFromDraggable(draggable);
                        }

                        if (graphVisible) {
                            ui.helper.toggleClass('draggable-invisible', enabled);
                        } else if (dashboardVisible) {
                            self.trigger('menubarToggleDisplay', { name: 'graph' });
                            dashboardVisible = false;
                            graphVisible = true;
                        }

                        self.trigger('toggleWorkspaceFilter', { enabled: !enabled });
                        if (graphVisible) {
                            if (enabled) {
                                self.trigger('verticesHovering', {
                                    vertices: vertices,
                                    start: start,
                                    position: { x: event.pageX, y: event.pageY }
                                });
                                start = false;
                            } else {
                                self.trigger('verticesHoveringEnded');
                            }
                        }
                    });
                },
                drop: function(event, ui) {
                    $('.draggable-wrapper').remove();

                    // Early exit if should leave to a different droppable
                    if (!enabled) return;

                    var vertices = verticesFromDraggable(ui.draggable),
                        graphVisible = $('.graph-pane-2d').is('.visible');

                    if (graphVisible && vertices.length) {
                        vertices[0].workspace.dropPosition = { x: event.clientX, y: event.clientY };
                    }

                    self.workspaceReady(function(ws) {
                        if (ws.editable) {
                            self.trigger('clearWorkspaceFilter');
                            self.trigger('verticesDropped', { vertices: vertices });
                        }
                    });
                }.bind(this)
            });

            function verticesFromDraggable(draggable) {
                var alsoDragging = draggable.data('ui-draggable').alsoDragging,
                    anchors = draggable;

                if (alsoDragging && alsoDragging.length) {
                    anchors = draggable.add(alsoDragging.map(function(i, a) {
                        return a.data('original');
                    }));
                }

                return anchors.map(function(i, a) {
                    a = $(a);
                    var id = a.data('vertexId') || a.closest('li').data('vertexId');
                    if (a.is('.facebox')) return;

                    if (!id) {

                        // Highlighted entities (legacy info)
                        var info = a.data('info') || a.closest('li').data('info'),
                            vertexId = info && (info.resolvedToVertexId || info.graphVertexId || info.id);

                        if (vertexId) {
                            var properties = [
                                { name: 'http://lumify.io#title', value: info.title },
                                { name: 'http://lumify.io#conceptType', value: info['http://lumify.io#conceptType'] },
                            ];

                            id = vertexId;

                            if (!(id in self.cachedVertices)) {
                                // Insert stub, since this is synchronous, but
                                // then refresh with server
                                self.updateCacheWithVertex({ id: id, properties: properties });
                                self.refresh([id], true);
                            }
                        }

                        // Detected objects
                        if (info && info.entityVertex) {
                            self.updateCacheWithVertex(info.entityVertex);
                            id = info.entityVertex.id;
                        }

                        if (!id) return console.error('No data-vertex-id attribute for draggable element found', a[0]);
                    }

                    return self.vertex(id);
                }).toArray();
            }
        };

        this.precacheIcons = function(concepts) {
            var urls = _.chain(concepts.byId)
                .values()
                .pluck('glyphIconHref')
                .compact()
                .unique()
                .value();

            cacheNextImage(urls);

            function cacheNextImage(urls) {
                if (!urls.length) {
                    return;
                }

                var url = urls.shift();

                deferredImage(url).always(function() {
                    cacheNextImage(urls);
                });
            }
        };
    }
});
