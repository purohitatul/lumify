
define([
    'flight/lib/component',
    'util/video/scrubber',
    'util/audio/scrubber',
    'util/privileges',
    './image/image',
    '../withTypeContent',
    '../withHighlighting',
    '../toolbar/toolbar',
    'detail/dropdowns/termForm/termForm',
    'detail/properties/properties',
    'tpl!./artifact',
    'tpl!./transcriptEntry',
    'hbs!./transcriptEntries',
    'tpl!util/alert',
    'util/vertex/formatters',
    'service/ontology',
    'service/vertex',
    'service/config',
    'data',
    'd3'
], function(
    defineComponent,
    VideoScrubber,
    AudioScrubber,
    Privileges,
    Image,
    withTypeContent, withHighlighting,
    Toolbar,
    TermForm,
    Properties,
    template,
    transcriptEntryTemplate,
    transcriptEntriesTemplate,
    alertTemplate,
    F,
    OntologyService,
    VertexService,
    ConfigService,
    appData,
    d3) {
    'use strict';

    return defineComponent(Artifact, withTypeContent, withHighlighting);

    function Artifact() {

        this.ontologyService = new OntologyService();
        this.vertexService = new VertexService();

        this.defaultAttrs({
            previewSelector: '.preview',
            audioPreviewSelector: '.audio-preview',
            currentTranscriptSelector: '.currentTranscript',
            imagePreviewSelector: '.image-preview',
            faceboxContainerSelector: '.image-preview, .background-scrubber',
            detectedObjectLabelsSelector: '.detected-object-labels',
            detectedObjectSelector: '.detected-object',
            detectedObjectTagSelector: '.detected-object-tag',
            artifactSelector: '.artifact-image',
            toolbarSelector: '.comp-toolbar',
            propertiesSelector: '.properties',
            titleSelector: '.artifact-title',
            timestampAnchorSelector: '.av-times a'
        });

        this.after('initialize', function() {
            var self = this;

            this.on('click', {
                detectedObjectSelector: this.onDetectedObjectClicked,
                timestampAnchorSelector: this.onTimestampClicked
            });
            this.on('scrubberFrameChange', this.onScrubberFrameChange);
            this.on('playerTimeUpdate', this.onPlayerTimeUpdate);
            this.on('DetectedObjectCoordsChange', this.onCoordsChanged);
            this.on('termCreated', this.onTeardownDropdowns);
            this.on('dropdownClosed', this.onTeardownDropdowns);
            this.on(document, 'verticesUpdated', this.onVerticesUpdated);
            this.on('openOriginal', this.onOpenOriginal);
            this.on('downloadOriginal', this.onDownloadOriginal);
            this.after('tearDownDropdowns', this.onTeardownDropdowns);

            this.before('teardown', function() {
                self.$node.off('.detectedObject');
            })

            // Replace function to handle json transcripts
            this.processArtifactText = this.artifactTextHandler;

            this.loadArtifact();
        });

        this.before('teardown', function() {
            this.select('propertiesSelector').teardownComponent(Properties);
        });

        this.onOpenOriginal = function(event) {
            window.open(this.attr.data.imageRawSrc);
        };

        this.onDownloadOriginal = function(event) {
            window.open(this.attr.data.imageRawSrc + (
                /\?/.test(this.attr.data.imageRawSrc) ? '&' : '?'
            ) + 'download=true');
        };

        this.onVerticesUpdated = function(event, data) {
            var matching = _.findWhere(data.vertices, { id: this.attr.data.id });

            if (matching) {
                this.attr.data = matching;
                this.update();
            }
        };

        this.loadArtifact = function() {
            var self = this,
                vertex = self.attr.data;

            $.when(
                this.handleCancelling(appData.refresh(vertex)),
                new ConfigService().getProperties()
            ).done(this.handleVertexLoaded.bind(this));
        };

        this.handleVertexLoaded = function(vertex, config) {
            var self = this,
                displayType = this.attr.data.concept.displayType,
                properties = vertex && vertex.properties;

            this.attr.data = vertex;

            if (properties && displayType) {
                var durationProperty = _.findWhere(properties, {
                    name: config['ontology.iri.' + displayType + 'Duration']
                });

                if (durationProperty) {
                    this.duration = durationProperty.value * 1000;
                }
            }

            this.$node.html(template({
                vertex: vertex,
                F: F
            }));

            Properties.attachTo(this.select('propertiesSelector'), { data: vertex });

            Toolbar.attachTo(this.select('toolbarSelector'), {
                toolbar: [
                    {
                        title: i18n('detail.toolbar.open'),
                        submenu: [
                            Toolbar.ITEMS.FULLSCREEN,
                            Toolbar.ITEMS.DIVIDER,
                            self.sourceUrlToolbarItem(),
                            {
                                title: i18n('detail.artifact.open.original'),
                                subtitle: i18n('detail.artifact.open.original.subtitle'),
                                event: 'openOriginal'
                            },
                            {
                                title: i18n('detail.artifact.open.download.original'),
                                subtitle: i18n('detail.artifact.open.download.original.subtitle'),
                                event: 'downloadOriginal'
                            }
                        ]
                    },
                    {
                        title: i18n('detail.toolbar.add'),
                        cls: 'requires-EDIT',
                        submenu: [
                            Toolbar.ITEMS.ADD_PROPERTY
                        ]
                    },
                    Toolbar.ITEMS.AUDIT
                ]
            });

            this.update()
            this.updateText();

            if (this[displayType + 'Setup']) {
                this[displayType + 'Setup'](this.attr.data);
            }
        };

        this.update = function() {
            this.updateTitle();
            this.updateDetectedObjects();
        };

        this.updateTitle = function() {
            this.select('titleSelector')
                .text(F.vertex.title(this.attr.data))
                .next('.subtitle')
                .text(this.attr.data.concept.displayName);
        };

        this.updateDetectedObjects = function() {
            var self = this,
                vertex = this.attr.data,
                wasResolved = {},
                needsLoading = [],
                detectedObjects = vertex && F.vertex.props(vertex, 'detectedObject') || [],
                container = this.select('detectedObjectLabelsSelector').toggle(detectedObjects.length > 0);

            detectedObjects.forEach(function(detectedObject) {
                var key = detectedObject.value.originalPropertyKey,
                    resolvedVertexId = detectedObject.value.resolvedVertexId;

                if (key) {
                    wasResolved[key] = true;
                }

                if (resolvedVertexId) {
                    needsLoading.push(resolvedVertexId);
                }
            });

            $.when(
                appData.refresh(needsLoading),
                this.ontologyService.concepts()
            ).done(function(vertices, concepts) {
                var verticesById = _.indexBy(vertices, 'id'),
                    detectedObjectKey = _.property('key');

                d3.select(container.get(0))
                    .selectAll('.detected-object-tag')
                    .data(detectedObjects, detectedObjectKey)
                    .call(function() {
                        this.enter()
                            .append('span')
                            .attr('class', 'detected-object-tag')
                            .append('a')

                        this
                            .sort(function(a, b) {
                                return a.value.x1 - b.value.x1;
                            })
                            .style('display', function(detectedObject) {
                                if (wasResolved[detectedObject.key]) {
                                    return 'none';
                                }
                            })
                            .select('a')
                                .attr('data-vertex-id', function(detectedObject) {
                                    return detectedObject.value.resolvedVertexId;
                                })
                                .attr('data-property-key', detectedObjectKey)
                                .attr('class', function(detectedObject) {
                                    var classes = 'label label-info detected-object opens-dropdown';
                                    if (detectedObject.value.edgeId) {
                                        return classes + ' resolved entity'
                                    }
                                    return classes;
                                })
                                .text(function(detectedObject) {
                                    var resolvedVertexId = detectedObject.value.resolvedVertexId,
                                        resolvedVertex = resolvedVertexId && verticesById[resolvedVertexId];
                                    if (resolvedVertex) {
                                        return F.vertex.title(resolvedVertex);
                                    } else if (resolvedVertexId) {
                                        return i18n('detail.detected_object.vertex_not_found');
                                    }
                                    return concepts.byId[detectedObject.value.concept].displayName;
                                })
                    })
                    .exit().remove();

                    self.$node
                        .off('.detectedObject')
                        .on('mouseenter.detectedObject mouseleave.detectedObject',
                            self.attr.detectedObjectTagSelector,
                            self.onDetectedObjectHover.bind(self)
                        );

                    if (vertices.length) {
                        self.trigger('updateDraggables');
                    }
                });
        };

        this.onPlayerTimeUpdate = function(evt, data) {
            var time = data.currentTime * 1000;
            this.updateCurrentTranscript(time);
        };

        this.onScrubberFrameChange = function(evt, data) {
            if (!this.duration) {
                if (!this._noDurationWarned) {
                    console.warn('No duration property for artifact, unable to sync transcript');
                    this._noDurationWarned = true;
                }
                return;
            }
            var frameIndex = data.index,
                numberOfFrames = data.numberOfFrames,
                time = (this.duration / numberOfFrames) * frameIndex;

            this.updateCurrentTranscript(time);
        };

        this.updateCurrentTranscript = function(time) {
            var transcriptEntry = this.findTranscriptEntryForTime(time),
                html = '';

            if (transcriptEntry) {
                html = transcriptEntryTemplate({
                    transcriptEntry: transcriptEntry,
                    formatTimeOffset: this.formatTimeOffset
                });
            }
            this.select('currentTranscriptSelector').html(html);
        };

        this.findTranscriptEntryForTime = function(time) {
            if (!this.currentTranscript || !this.currentTranscript.entries) {
                return null;
            }
            var bestMatch = this.currentTranscript.entries[0];
            for (var i = 0; i < this.currentTranscript.entries.length; i++) {
                if (this.currentTranscript.entries[i].start <= time) {
                    bestMatch = this.currentTranscript.entries[i];
                }
            }
            return bestMatch;
        };

        this.formatTimeOffset = function(time) {
            return sf('{0:h:mm:ss}', new sf.TimeSpan(time));
        };

        this.onTimestampClicked = function(event) {
            var millis = $(event.target).data('millis');

            this.trigger(
                this.select('audioPreviewSelector').add(this.select('previewSelector')),
                'seekToTime', {
                seekTo: millis
            });
        };

        this.onDetectedObjectClicked = function(event) {
            if (Privileges.missingEDIT) {
                return;
            }

            event.preventDefault();

            var self = this,
                $target = $(event.target),
                propertyKey = $target.closest('.label-info').data('propertyKey'),
                property = F.vertex.propForNameAndKey(this.attr.data, 'http://lumify.io#detectedObject', propertyKey);

            this.$node.find('.focused').removeClass('focused')
            $target.closest('.detected-object').parent().addClass('focused');

            require(['util/actionbar/actionbar'], function(ActionBar) {
                self.ActionBar = ActionBar;
                ActionBar.teardownAll();
                self.off('.actionbar');

                if ($target.hasClass('resolved')) {

                    ActionBar.attachTo($target, {
                        alignTo: 'node',
                        actions: $.extend({
                            Open: 'open.actionbar'
                        }, Privileges.canEDIT ? {
                            Unresolve: 'unresolve.actionbar'
                        } : {})
                    });

                    self.on('open.actionbar', function() {

                        self.trigger('selectObjects', {
                            vertices: [
                                {
                                    id: property.value.resolvedVertexId
                                }
                            ]
                        });
                    });
                    self.on('unresolve.actionbar', function() {
                        _.defer(
                            self.showForm.bind(self),
                            $.extend({}, property.value, {
                                title: F.vertex.title(appData.cachedVertices[property.value.resolvedVertexId]),
                                propertyKey: property.key
                            }),
                            $target
                        );
                    });

                } else if (Privileges.canEDIT) {

                    ActionBar.attachTo($target, {
                        alignTo: 'node',
                        actions: {
                            Resolve: 'resolve.actionbar'
                        }
                    });

                    self.on('resolve.actionbar', function() {
                        self.trigger(self.select('imagePreviewSelector'), 'DetectedObjectEdit', property);
                        _.defer(
                            self.showForm.bind(self),
                            $.extend({}, property.value, { originalPropertyKey: property.key }),
                            $target
                        );
                    })
                }
            });
        };

        this.onCoordsChanged = function(event, data) {
            var self = this,
                vertex = appData.vertex(this.attr.data.id),
                detectedObject = F.vertex.propForNameAndKey(vertex, 'http://lumify.io#detectedObject', data.id),
                width = parseFloat(data.x2) - parseFloat(data.x1),
                height = parseFloat(data.y2) - parseFloat(data.y1),
                newDetectedObject = $.extend(true, {}, detectedObject, { value: data }),
                dataInfo = $.extend({}, detectedObject && detectedObject.value || {}, data);

            if ((this.$node.width() * width) < 5 ||
                (this.$node.height() * height) < 5) {
                this.$node.find('.underneath').teardownComponent(TermForm)
                return;
            }

            if (detectedObject) {
                dataInfo.originalPropertyKey = detectedObject.key;
            }

            delete dataInfo.id;

            if (data.id === 'NEW') {
                dataInfo.isNew = true;
            }
            this.showForm(dataInfo, this.$node);
            this.trigger(this.select('imagePreviewSelector'), 'DetectedObjectEdit', newDetectedObject);
            this.select('detectedObjectLabelsSelector').show();
            this.$node.find('.detected-object-labels .detected-object').each(function() {
                if ($(this).data('propertyKey') === data.id) {
                    $(this).closest('span').addClass('focused')
                }
            });
        };

        this.onTeardownDropdowns = function() {
            this.$node.find('.detected-object-labels .focused').removeClass('focused')
            this.trigger(this.select('imagePreviewSelector'), 'DetectedObjectDoneEditing');
        };

        this.onDetectedObjectHover = function(event) {
            var $target = $(event.target),
                tag = $target.closest('.detected-object-tag'),
                badge = tag.find('.label-info'),
                propertyKey = badge.data('propertyKey');

            this.trigger(
                this.select('faceboxContainerSelector'),
                event.type === 'mouseenter' ? 'DetectedObjectEnter' : 'DetectedObjectLeave',
                F.vertex.propForNameAndKey(this.attr.data, 'http://lumify.io#detectedObject', propertyKey)
            );
        };

        this.audioSetup = function(vertex) {
            AudioScrubber.attachTo(this.select('audioPreviewSelector'), {
                rawUrl: vertex.imageRawSrc
            })
        };

        this.videoSetup = function(vertex) {
            this.select('detectedObjectLabelsSelector').hide();
            VideoScrubber.attachTo(this.select('previewSelector'), {
                rawUrl: vertex.imageRawSrc,
                posterFrameUrl: vertex.imageSrc,
                videoPreviewImageUrl: vertex.imageFramesSrc,
                duration: this.duration,
                allowPlayback: true
            });
        };

        this.imageSetup = function(vertex) {
            var self = this,
                data = {
                    src: vertex.imageDetailSrc,
                    id: vertex.id
                };
            Image.attachTo(this.select('imagePreviewSelector'), { data: data });
            this.before('teardown', function() {
                self.select('imagePreviewSelector').teardownComponent(Image);
            });
        };

        this.showForm = function(dataInfo, $target) {
            this.$node.find('.underneath').teardownComponent(TermForm)
            var root = $('<div class="underneath">');

            if (dataInfo.isNew) {
                root.insertAfter($target.closest('.type-content').find('.image-preview'));
            } else {
                root.insertAfter($target.closest('.type-content').find('.detected-object-labels'));
            }

            TermForm.attachTo (root, {
                artifactData: this.attr.data,
                dataInfo: dataInfo,
                restrictConcept: dataInfo.concept,
                existing: !!dataInfo.resolvedVertexId,
                detectedObject: true
            });
        };

        this.artifactTextHandler = function(text) {
            var self = this,
                warningText = i18n('detail.text.none_available');

            // Looks like JSON ?
            if (/^\s*{/.test(text)) {
                var json;
                try {
                    json = JSON.parse(text);
                } catch(e) { }

                if (json && !_.isEmpty(json.entries)) {
                    this.currentTranscript = json;
                    return transcriptEntriesTemplate({
                        entries: _.map(json.entries, function(e) {
                            return {
                                millis: e.start || e.end,
                                time: (_.isUndefined(e.start) ? '' : self.formatTimeOffset(e.start)) +
                                        ' - ' +
                                      (_.isUndefined(e.end) ? '' : self.formatTimeOffset(e.end)),
                                text: e.text
                            };
                        })
                    });
                } else if (json) {
                    text = null;
                    warningText = i18n('detail.transcript.none_available');
                }
            }

            return !text ?  alertTemplate({ warning: warningText }) : this.normalizeString(text);
        }
     }
});
