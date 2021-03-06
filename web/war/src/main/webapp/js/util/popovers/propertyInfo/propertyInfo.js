
define([
    'flight/lib/component',
    '../withPopover',
    'service/config',
    'util/vertex/formatters',
    'd3'
], function(
    defineComponent,
    withPopover,
    ConfigService,
    F,
    d3) {
    'use strict';

    var configService = new ConfigService();

    return defineComponent(PropertyInfo, withPopover);

    function PropertyInfo() {

        this.defaultAttrs({
            deleteButtonSelector: '.btn-danger',
            editButtonSelector: '.btn-edit',
            addButtonSelector: '.btn-add',
            justificationValueSelector: 'a'
        });

        this.before('initialize', function(node, config) {
            config.template = 'propertyInfo/template';
        });

        this.after('initialize', function() {
            var self = this;

            this.after('setupWithTemplate', function() {
                configService.getProperties().done(function(config) {
                    var splitRegex = /\s*,\s*/,
                        metadataDisplay =
                            config['properties.metadata.propertyNamesDisplay'].split(splitRegex).map(i18n),
                        metadataType =
                            config['properties.metadata.propertyNamesType'].split(splitRegex);

                    self.metadataProperties =
                        config['properties.metadata.propertyNames'].split(splitRegex);

                    if (self.metadataProperties.length !== metadataDisplay.length ||
                        self.metadataProperties.length !== metadataType.length) {
                        throw new Error('Metadata properties must have display names and types');
                    }
                    self.metadataPropertiesDisplayMap = _.object(self.metadataProperties, metadataDisplay);
                    self.metadataPropertiesTypeMap = _.object(self.metadataProperties, metadataType);

                    self.on(self.popover, 'click', {
                        deleteButtonSelector: self.onDelete,
                        editButtonSelector: self.onEdit,
                        addButtonSelector: self.onAdd,
                        justificationValueSelector: self.teardown
                    });

                    self.contentRoot = d3.select(self.popover.get(0))
                        .select('.popover-content');
                    self.update(self.attr.property);

                    self.on(document, 'verticesUpdated', self.onVerticesUpdated);
                });
            });
        });

        this.update = function(property) {
            var vertexId = this.attr.vertexId,
                positionDialog = this.positionDialog.bind(this),
                displayNames = this.metadataPropertiesDisplayMap,
                displayTypes = this.metadataPropertiesTypeMap,
                canEdit = F.vertex.sandboxStatus(property) ||
                    property.name === 'http://lumify.io#visibilityJson',
                canDelete = canEdit && property.name !== 'http://lumify.io#visibilityJson',
                metadata = _.pick.apply(_, [property].concat(this.metadataProperties)),
                transformed = _.chain(metadata)
                    .pairs()
                    .value(),
                row = this.contentRoot.select('table')
                    .selectAll('tr')
                    .data(transformed)
                    .call(function() {
                        this.enter()
                            .append('tr')
                            .call(function() {
                                this.append('td').attr('class', 'property-name');
                                this.append('td').attr('class', 'property-value');
                            });
                    });

            this.contentRoot.select('.btn-danger')
                .style('display', canDelete ? 'inline' : 'none');
            this.contentRoot.select('.editadd')
                .classed('btn-edit', canEdit)
                .classed('btn-add', !canEdit)
                .classed('nodelete', !canDelete)
                .text(canEdit ?
                  i18n('popovers.property_info.button.edit') :
                  i18n('popovers.property_info.button.add')
                );
            this.contentRoot.selectAll('tr')
                .call(function() {
                    var self = this;

                    this.select('td.property-name').text(function(d) {
                        return displayNames[d[0]];
                    });

                    var valueElement = self.select('td.property-value')
                        .each(function(d) {
                            var self = this,
                                $self = $(this),
                                typeName = displayTypes[d[0]],
                                formatter = F.vertex.metadata[typeName],
                                formatterAsync = F.vertex.metadata[typeName + 'Async'],
                                value = d[1];

                            if (formatter) {
                                formatter(this, value);
                            } else if (formatterAsync) {
                                formatterAsync(self, value, property, vertexId)
                                    .fail(function() {
                                        d3.select(self).text(i18n('popovers.property_info.error', value));
                                    })
                                    .always(positionDialog);
                                d3.select(this).text(i18n('popovers.property_info.loading'));
                            } else {
                                console.warn('No metadata type formatter: ' + typeName);
                                d3.select(this).text(value);
                            }
                        });
                })

                // Hide blank metadata
                .each(function(d) {
                    $(this).toggle($(this).find('.property-value').text() !== '');
                });

            // Justification
            var justification = [];
            if (property._justificationMetadata || property._sourceMetadata) {
                justification.push(true);
            }

            var table = this.contentRoot.select('table'),
                justificationRow = this.contentRoot.selectAll('.justification')

            justificationRow
                .data(justification)
                .call(function() {
                    this.enter()
                        .call(function() {
                            this.insert('div', 'button').attr('class', 'justification')
                                .call(function() {
                                    this.append('div')
                                        .attr('class', 'property-name property-justification')
                                        .text(i18n('popovers.property_info.justification'));
                                    this.append('div')
                                        .attr('class', 'justificationValue');
                                });
                        });
                    this.exit().remove();

                    var node = this.select('.justificationValue').node();
                    if (node) {
                        require(['util/vertex/justification/viewer'], function(JustificationViewer) {
                            $(node).teardownAllComponents();
                            JustificationViewer.attachTo(node, {
                                justificationMetadata: property._justificationMetadata,
                                sourceMetadata: property._sourceMetadata
                            });
                            positionDialog();
                        });
                    }
                })

            row.exit().remove();

            positionDialog();
        };

        this.onVerticesUpdated = function(event, data) {
            var vertex = _.findWhere(data.vertices, {
                    id: this.attr.vertexId
                }),
                property = vertex && _.findWhere(vertex.properties, {
                    name: this.attr.property.name,
                    key: this.attr.property.key
                });
            if (vertex && !property) {
                this.teardown();
            } else if (property) {
                this.attr.property = property;
                this.update(property);
            }
        };

        this.onAdd = function() {
            this.trigger('editProperty', {
                property: _.omit(this.attr.property, 'key')
            });
            this.teardown();
        };

        this.onEdit = function() {
            this.trigger('editProperty', {
                property: this.attr.property
            });
            this.teardown();
        };

        this.onDelete = function(e) {
            var button = this.select('deleteButtonSelector').addClass('loading').attr('disabled', true);
            this.trigger('deleteProperty', {
                property: _.pick(this.attr.property, 'name', 'key')
            });
        };
    }
});
