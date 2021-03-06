
define([
    'flight/lib/component',
    './withVertexPopover',
    'service/vertex',
    'service/ontology',
    'service/edge',
    'util/withFormFieldErrors',
    'util/withTeardown'
], function(
    defineComponent,
    withVertexPopover,
    VertexService,
    OntologyService,
    EdgeService,
    withFormFieldErrors,
    withTeardown) {
    'use strict';

    return defineComponent(
        CreateConnectionPopover,
        withVertexPopover,
        withFormFieldErrors,
        withTeardown
    );

    function CreateConnectionPopover() {

        this.vertexService = new VertexService();
        this.ontologyService = new OntologyService();
        this.edgeService = new EdgeService();

        this.defaultAttrs({
            connectButtonSelector: '.connect-dialog .btn-primary',
            invertButtonSelector: '.connect-dialog .btn-link'
        });

        this.before('initialize', function(node, config) {
            config.template = 'createConnectionPopover';
        });

        this.after('initialize', function() {
            this.on('click', {
                connectButtonSelector: this.onCreateConnection,
                invertButtonSelector: this.onInvert
            });
        });

        this.popoverInitialize = function() {
            this.visibilitySource = { value: '', valid: true };
            this.on('visibilitychange', this.onVisibilityChange);
            this.on('justificationchange', this.onJustificationChange);
            this.on('justificationanimationend', this.onJustificationAnimationEnd);

            this.updateRelationshipLabels();
        };

        this.updateRelationshipLabels = function() {
            var self = this,
                select = this.popover.find('select'),
                button = this.select('connectButtonSelector');

            select.html('<option>' + i18n('popovers.connection.loading') + '</option>');
            button.text(i18n('popovers.connection.button.connect')).attr('disabled', true);

            this.getRelationshipLabels(
                this.attr.otherCyNode,
                this.attr.cyNode
            ).fail(function() {
                select.html('<option>' + i18n('popovers.connection.error') + '</option>');
            }).done(function(relationships) {

                if (relationships.length) {
                    select.html(
                        relationships.map(function(d) {
                            return '<option value="' + d.title + '">' + d.displayName + '</option>';
                        }).join('')
                    );

                    require([
                        'configuration/plugins/visibility/visibilityEditor',
                        'detail/dropdowns/propertyForm/justification',
                    ], function(Visibility, Justification) {
                        Visibility.attachTo(self.$node.find('.visibility'), {
                            value: ''
                        });
                        Justification.attachTo(self.$node.find('.justification'));
                        self.positionDialog();
                        self.checkValid();
                    });
                } else {
                    select.html('<option>' + i18n('relationship.form.no_valid_relationships') + '</option>');
                }

                self.positionDialog();
            });
        }

        this.onVisibilityChange = function(event, data) {
            this.visibilitySource = data;
            this.checkValid();
        };

        this.onJustificationChange = function(event, data) {
            this.justification = data;
            this.checkValid();
        };

        this.onJustificationAnimationEnd = function() {
        };

        this.checkValid = function() {
            var button = this.select('connectButtonSelector'),
                select = this.popover.find('select');

            if (select.val() &&
                this.visibilitySource && this.visibilitySource.valid &&
                this.justification && this.justification.valid) {
                button.removeAttr('disabled');
            } else {
                button.attr('disabled', true);
            }
        }

        this.onInvert = function(e) {
            var self = this;

            if (this.ignoreViewportChanges) {
                return;
            }

            if (!this.currentNodeIndex) {
                this.currentNodeIndex = 1;
                this.nodes = [this.attr.cyNode, this.attr.otherCyNode];
            }

            var node = this.nodes[this.currentNodeIndex % 2],
                other = this.nodes[(this.currentNodeIndex + 1) % 2],
                otherTitle = other.data('truncatedTitle'),
                currentNodePosition = node.renderedPosition(),
                otherNodePosition = other.renderedPosition();

            this.currentNodeIndex++;

            this.ignoreViewportChanges = true;
            this.attr.cy.panByAnimated({
                x: otherNodePosition.x - currentNodePosition.x,
                y: otherNodePosition.y - currentNodePosition.y
            }, {
                callback: function() {
                    self.popover.find('.title').text(otherTitle);
                    self.attr.cyNode = node;
                    self.attr.otherCyNode = other;
                    self.updateRelationshipLabels();
                    self.ignoreViewportChanges = false;
                    self.onViewportChanges();
                }
            });
        };

        this.onCreateConnection = function(e) {
            var self = this,
                $target = $(e.target)
                    .text('Connecting...')
                    .attr('disabled', true),
                parameters = {
                    sourceGraphVertexId: this.attr.sourceVertexId,
                    destGraphVertexId: this.attr.targetVertexId,
                    predicateLabel: $target.siblings('select').val(),
                    visibilitySource: this.visibilitySource.value
                },
                inputs = this.$node.find('select, input')
                    .attr('disabled', true);

            if (this.attr.otherCyNode.id() !== this.attr.edge.data('source')) {
                // Invert
                parameters.sourceGraphVertexId = this.attr.targetVertexId;
                parameters.destGraphVertexId = this.attr.sourceVertexId;
            }

            this.attr.teardownOnTap = false;

            if (this.justification.sourceInfo) {
                parameters.sourceInfo = JSON.stringify(this.justification.sourceInfo);
            } else if (this.justification.justificationText) {
                parameters.justificationText = this.justification.justificationText;
            }

            this.edgeService.create(parameters)
                .always(function() {
                    self.attr.teardownOnTap = true;
                })
                .fail(function(req, reason, statusText) {
                    $target.text(i18n('popovers.connection.button.connect'))
                        .add(inputs)
                        .removeAttr('disabled');
                    self.markFieldErrors(statusText);
                })
                .done(function(data) {
                    self.on(document, 'relationshipsLoaded', function loaded() {
                        self.trigger('finishedVertexConnection');
                        self.off(document, 'relationshipsLoaded', loaded);
                    });
                    self.trigger('refreshRelationships');
                });
        };

        this.getRelationshipLabels = function(source, dest) {
            var self = this,
                sourceConceptTypeId = source.data('conceptType'),
                destConceptTypeId = dest.data('conceptType');

            return $.when(
                this.ontologyService.conceptToConceptRelationships(sourceConceptTypeId, destConceptTypeId),
                this.ontologyService.relationships()
            ).then(function(relationships, ontologyRelationships) {
                var relationshipsTpl = [];

                relationships.forEach(function(relationship) {
                    var ontologyRelationship = ontologyRelationships.byTitle[relationship.title],
                        displayName;
                    if (ontologyRelationship) {
                        displayName = ontologyRelationship.displayName;
                    } else {
                        displayName = relationship.title;
                    }

                    var data = {
                        title: relationship.title,
                        displayName: displayName
                    };

                    relationshipsTpl.push(data);
                });

                return relationshipsTpl;

            });
        };
    }
});
