
define([
    'flight/lib/component',
    'service/ontology',
    'service/vertex',
    'service/edge',
    'service/config',
    'util/vertex/formatters',
    'util/privileges',
    '../dropdowns/propertyForm/propForm',
    'hbs!../audit/audit-list',
    'data',
    'sf',
    'd3'
], function(
    defineComponent,
    OntologyService,
    VertexService,
    EdgeService,
    ConfigService,
    F,
    Privileges,
    PropertyForm,
    auditsListTemplate,
    appData,
    sf,
    d3) {
    'use strict';

    var component = defineComponent(Properties),
        VISIBILITY_NAME = 'http://lumify.io#visibilityJson',
        AUDIT_DATE_DISPLAY = ['date-relative', 'date'],
        AUDIT_DATE_DISPLAY_RELATIVE = 0,
        AUDIT_DATE_DISPLAY_REAL = 1,
        MAX_AUDIT_ITEMS = 3,
        CURRENT_DATE_DISPLAY = AUDIT_DATE_DISPLAY_RELATIVE,
        NO_GROUP = '${NO_GROUP}',

        // Property td types
        GROUP = 0, NAME = 1, VALUE = 2,

        alreadyWarnedAboutMissingOntology = {},
        ontologyService = new OntologyService(),
        vertexService = new VertexService(),
        edgeService = new EdgeService(),
        configService = new ConfigService();

    return component;

    function isVisibility(property) {
        return property.name === VISIBILITY_NAME;
    }

    function isJustification(property) {
        return (
            property.name === '_justificationMetadata' ||
            property.name === '_sourceMetadata'
        );
    }

    function Properties() {

        this.defaultAttrs({
            entityAuditsSelector: '.entity_audit_events',
            auditShowAllSelector: '.show-all-button-row button',
            auditDateSelector: '.audit-date',
            auditUserSelector: '.audit-user',
            auditEntitySelector: '.resolved',
            propertiesInfoSelector: 'button.info'
        });

        this.showPropertyInfo = function(button, property) {
            var vertexId = this.attr.data.id,
                $target = $(button),
                shouldOpen = $target.lookupAllComponents().length === 0;

            require(['util/popovers/propertyInfo/propertyInfo'], function(PropertyInfo) {
                if (shouldOpen) {
                    PropertyInfo.teardownAll();
                    PropertyInfo.attachTo($target, {
                        property: property,
                        vertexId: vertexId
                    });
                } else {
                    $target.teardownComponent(PropertyInfo);
                }
            });
        };

        this.update = function(properties) {
            var self = this,
                displayProperties = this.transformPropertiesForUpdate(properties);

            this.reload = this.update.bind(this, properties);

            this.tableRoot.selectAll('tbody.property-group')
                .data(displayProperties)
                .call(
                    _.partial(
                        createPropertyGroups,
                        self.attr.data.id,
                        self.ontologyProperties,
                        self.showMoreExpanded,
                        parseInt(self.config['properties.multivalue.defaultVisibleCount'], 10)
                    )
                );

                /*
                row = this.tableRoot.selectAll('tr.property-row')
                    .data(displayProperties)
                    .call(function() {
                        this.enter()
                            .insert('tr', '.buttons-row')
                            .call(function() {
                                this.append('td')
                                    .attr('class', 'property-name')
                                    .attr('width', '40%')
                                    .append('strong')

                                this.append('td')
                                    .attr('class', 'property-value')
                                    .attr('colspan', 2)
                                    .call(function() {
                                        this.append('span').attr('class', 'value');
                                        this.append('button')
                                            .attr('class', 'info')
                                        this.append('span').attr('class', 'visibility');
                                        this.append('a').attr('class', 'show-more');
                                    })
                            });

                        var propertyCountByName = {},
                            propertyPreventHideByName = {},
                            maxProperties = parseInt(self.config['properties.multivalue.defaultVisibleCount'], 10);

                        this.each(function(property) {
                            var classes = ['property-row'],
                                count = propertyCountByName[property.name] || 0,
                                $this = $(this);

                            propertyCountByName[property.name] = ++count;

                            if (count > maxProperties) {
                                if ($this.hasClass('unhide')) {
                                    propertyPreventHideByName[property.name] = true;
                                    classes.push('unhide');
                                } else if (count === maxProperties + 1) {
                                    $this.prev('.property-row').addClass('last-not-hidden');
                                }

                                if (propertyPreventHideByName[property.name] !== true) {
                                    classes.push('hidden');
                                }
                            }

                            $this.attr('class', classes.join(' '));
                        });
                        this.select('.show-more')
                            .text(function(property) {
                                return i18n(
                                    'properties.button.show_more',
                                    F.number.pretty(propertyCountByName[property.name] - maxProperties)
                                );
                            })
                            .on('click', function() {
                                $(this)
                                    .closest('tr').removeClass('last-not-hidden')
                                    .nextUntil(':not(.hidden)').addClass('unhide');
                            })
                        this.select('button.info')
                            .on('click', function(property) {
                                d3.event.stopPropagation();
                                d3.event.preventDefault();
                                self.showPropertyInfo(this, property);
                            });
                    });

            row.each(function(d) {
                $(this).removePrefixedClasses('property-row-')
                    .addClass('property-row-' + F.className.to(d.name + d.key));
            });

            row.select('td.property-name strong')
                .text(function(d, index) {
                    if (index > 0 && displayProperties[index - 1].name === d.name) {
                        return '';
                    }

                    if (isVisibility(d)) {
                        return i18n('visibility.label');
                    }

                    var ontologyProperty = self.ontologyProperties.byTitle[d.name];
                    if (ontologyProperty) {
                        return ontologyProperty.displayName;
                    }

                    if (d.displayName) {
                        return d.displayName;
                    }

                    console.warn('No ontology definition for ', d.name);
                    return d.name;
                });

            row.select('td.property-value')
                .each(function(property) {
                    var valueSpan = d3.select(this).select('.value').node(),
                        visibilitySpan = d3.select(this).select('.visibility').node(),
                        visibility = isVisibility(property),
                        ontologyProperty = self.ontologyProperties.byTitle[property.name],
                        dataType = ontologyProperty && ontologyProperty.dataType,
                        displayType = ontologyProperty && ontologyProperty.displayType;

                    valueSpan.textContent = '';
                    visibilitySpan.textContent = '';

                    if (visibility) {
                        dataType = 'visibility';
                    } else if (property.hideVisibility !== true) {
                        F.vertex.properties.visibility(
                            visibilitySpan, { value: property[VISIBILITY_NAME] }, self.attr.data.id);
                    }

                    $(this).find('button').toggle(Boolean(
                        !property.hideInfo &&
                        (Privileges.canEDIT || F.vertex.hasMetadata(property))
                    ));

                    if (displayType && F.vertex.properties[displayType]) {
                        F.vertex.properties[displayType](valueSpan, property, self.attr.data.id);
                        return;
                    } else if (dataType && F.vertex.properties[dataType]) {
                        F.vertex.properties[dataType](valueSpan, property, self.attr.data.id);
                        return;
                    }

                    if (isJustification(property)) {
                        require(['util/vertex/justification/viewer'], function(JustificationViewer) {
                            $(valueSpan).teardownAllComponents();
                            JustificationViewer.attachTo(valueSpan, property.justificationData);
                        });
                        return;
                    }

                    valueSpan.textContent = F.vertex.displayProp(property);
                });
            row.exit().remove()
            */
        };

        this.transformPropertiesForUpdate = function(properties) {
            var self = this,
                model = self.attr.data,
                isEdge = F.vertex.isEdge(model),
                displayProperties = _.chain(properties)
                    .filter(function(property) {
                        if (isEdge && isJustification(property)) {
                            $.extend(property, {
                                hideInfo: true,
                                hideVisibility: true,
                                displayName: i18n('justification.field.label'),
                                justificationData: {
                                    justificationMetadata: property.name === '_justificationMetadata' ?
                                        property.value : null,
                                    sourceMetadata: property.name === '_sourceMetadata' ?
                                        property.value : null
                                }
                            });
                            return true;
                        }

                        if (isVisibility(property)) {
                            return true;
                        }

                        var ontologyProperty = self.ontologyProperties.byTitle[property.name];
                        return ontologyProperty && ontologyProperty.userVisible;
                    })
                    .tap(function(properties) {
                        var visibility = _.find(properties, isVisibility);
                        if (!visibility) {
                            properties.push({
                                name: VISIBILITY_NAME,
                                value: self.attr.data[VISIBILITY_NAME]
                            });
                        }

                        if (isEdge && model.label) {
                            var ontologyRelationship = self.ontologyRelationships.byTitle[model.label];
                            properties.push({
                                name: 'relationshipLabel',
                                displayName: 'Type',
                                hideInfo: true,
                                hideVisibility: true,
                                value: ontologyRelationship ?
                                    ontologyRelationship.displayName :
                                    model.label
                            });
                        }
                    })
                    .sortBy(function(property) {
                        if (isVisibility(property)) {
                            return '0';
                        }

                        if (isEdge) {
                            return property.name === 'relationshipLabel' ?
                                '1' :
                                isJustification(property) ?
                                '2' : '3';
                        }

                        var ontologyProperty = self.ontologyProperties.byTitle[property.name];
                        if (ontologyProperty && ontologyProperty.propertyGroup) {
                            return '3' + ontologyProperty.propertyGroup.toLowerCase() + ontologyProperty.displayName;
                        }
                        if (ontologyProperty && ontologyProperty.displayName) {
                            return '1' + ontologyProperty.displayName.toLowerCase();
                        }
                        return '2' + property.name.toLowerCase();
                    })
                    .groupBy('name')
                    .pairs()
                    .groupBy(function(pair) {
                        var ontologyProperty = self.ontologyProperties.byTitle[pair[0]];
                        if (ontologyProperty && ontologyProperty.propertyGroup) {
                            return ontologyProperty.propertyGroup;
                        }

                        return NO_GROUP;
                    })
                    .pairs()
                    .value();

            return displayProperties;
        };

        this.after('initialize', function() {
            var self = this,
                properties = this.attr.data.properties,
                node = this.node,
                root = d3.select(node);

            root.append('div').attr('class', 'entity_audit_events');

            this.showMoreExpanded = {};
            this.tableRoot = root
                .append('table')
                .attr('class', 'table')
                .on('click', onTableClick.bind(this));

            $.when(
                ontologyService.relationships(),
                ontologyService.properties(),
                configService.getProperties()
            ).done(function(ontologyRelationships, ontologyProperties, config) {
                    self.config = config;
                    self.ontologyProperties = ontologyProperties;
                    self.ontologyRelationships = ontologyRelationships;
                    self.update(properties);
            });

            this.on('click', {
                auditDateSelector: this.onAuditDateClicked,
                auditUserSelector: this.onAuditUserClicked,
                auditShowAllSelector: this.onAuditShowAll,
                auditEntitySelector: this.onEntitySelected
            });
            this.on('addProperty', this.onAddProperty);
            this.on('deleteProperty', this.onDeleteProperty);
            this.on('editProperty', this.onEditProperty);
            this.on(document, 'verticesUpdated', this.onVerticesUpdated);
            this.on(document, 'edgesUpdated', this.onEdgesUpdated);

            var positionPopovers = _.throttle(function() {
                    self.trigger('positionPropertyInfo');
                }, 1000 / 60),
                scrollParent = this.$node.scrollParent();

            this.on(document, 'graphPaddingUpdated', positionPopovers);
            if (scrollParent.length) {
                this.on(scrollParent, 'scroll', positionPopovers);
            }

            this.$node
                .closest('.type-content')
                .off('.properties')
                .on('toggleAuditDisplay.properties', this.onToggleAuditing.bind(this));
        });

        this.before('teardown', function() {
            if (this.auditRequest && this.auditRequest.abort) {
                this.auditRequest.abort();
            }
        });

        this.onAuditShowAll = function(event) {
            var row = $(event.target).closest('tr');

            row.prevUntil('.property').removeClass('hidden');
            row.remove();
        };

        this.onEntitySelected = function(event) {
            var self = this,
                $target = $(event.target),
                info = $target.data('info');

            if (info) {
                event.preventDefault();

                var vertexId = info.graphVertexId,
                    vertex = appData.vertex(vertexId);
                if (!vertex) {
                    appData.refresh(vertexId).done(function(v) {
                        self.trigger('selectObjects', { vertices: [v] });
                    });
                } else {
                    this.trigger('selectObjects', { vertices: [vertex] });
                }
            }
        };

        this.onAuditDateClicked = function(event) {
            CURRENT_DATE_DISPLAY = (CURRENT_DATE_DISPLAY + 1) % AUDIT_DATE_DISPLAY.length;

            this.$node.find('.audit-date').each(function() {
                $(this).text($(this).data(AUDIT_DATE_DISPLAY[CURRENT_DATE_DISPLAY]));
            });
        };

        this.onAuditUserClicked = function(event) {
            var userId = $(event.target).data('userId');
            if (userId) {
                this.trigger('selectUser', { userId: userId });
            }
        };

        this.onToggleAuditing = function(event, data) {
            var self = this,
                auditsEl = this.select('entityAuditsSelector');

            if (data.displayed) {
                auditsEl.html('<div class="nav-header">Audits<span class="badge loading"/></div>').show();
                this.$node
                    .find('.audit-list').remove().end()
                    .find('.hidden').removeClass('hidden').end()
                    .find('.show-more').remove();

                $.when(
                        ontologyService.ontology(),
                        this.auditRequest = (F.vertex.isEdge(self.attr.data) ?
                                             edgeService : vertexService
                                            ).getAudits(this.attr.data.id)
                    ).done(function(ontology, auditResponse) {
                        var audits = _.sortBy(auditResponse[0].auditHistory, function(a) {
                                return new Date(a.dateTime).getTime() * -1;
                            }),
                            auditGroups = _.groupBy(audits, function(a) {
                                if (a.entityAudit) {
                                   if (a.entityAudit.analyzedBy) {
                                       a.data.displayType = a.entityAudit.analyzedBy;
                                   }
                                }

                                if (a.propertyAudit) {
                                    a.propertyAudit.isVisibility =
                                        a.propertyAudit.propertyName === 'http://lumify.io#visibilityJson';
                                    a.propertyAudit.visibilityValue = a.propertyAudit.propertyMetadata &&
                                        a.propertyAudit.propertyMetadata['http://lumify.io#visibilityJson'];
                                    a.propertyAudit.formattedValue = F.vertex.displayProp({
                                        name: a.propertyAudit.propertyName,
                                        value: a.propertyAudit.newValue || a.propertyAudit.previousValue
                                    });
                                    a.propertyAudit.isDeleted = a.propertyAudit.newValue === '';

                                    return 'property';
                                }

                                if (a.relationshipAudit) {
                                    a.relationshipAudit.sourceIsCurrent =
                                        a.relationshipAudit.sourceId === self.attr.data.id;
                                    a.relationshipAudit.sourceHref = F.vertexUrl.fragmentUrl(
                                        [a.relationshipAudit.sourceId], appData.workspaceId);
                                    a.relationshipAudit.sourceInfo =
                                        self.createInfoJsonFromAudit(a.relationshipAudit, 'source');

                                    a.relationshipAudit.destInfo =
                                        self.createInfoJsonFromAudit(a.relationshipAudit, 'dest');
                                    a.relationshipAudit.destHref = F.vertexUrl.fragmentUrl(
                                        [a.relationshipAudit.destId], appData.workspaceId);
                                }

                                return 'other';
                            });

                        self.select('entityAuditsSelector')
                            .empty()
                            .append('<table></table>')
                            .find('table')
                            .append(auditsListTemplate({
                                audits: auditGroups.other || [],
                                MAX_TO_DISPLAY: MAX_AUDIT_ITEMS
                            }));

                        if (auditGroups.property) {
                            self.updatePropertyAudits(auditGroups.property);
                        }
                        auditsEl.show();

                        self.trigger('updateDraggables');
                        self.updateVisibility();
                    });
            } else {
                auditsEl.hide();
                this.$node.find('.audit-row').remove();
                this.$node.find('.audit-only-property').remove();
                this.$node.find('.show-all-button-row').remove();
            }
        };

        this.updatePropertyAudits = function(audits) {
            var self = this,
                auditsByProperty = _.groupBy(audits, function(a) {
                    return a.propertyAudit.propertyName + a.propertyAudit.propertyKey;
                });

            Object.keys(auditsByProperty).forEach(function(propertyNameAndKey) {
                var propLi = self.$node.find('.property-row-' + F.className.to(propertyNameAndKey)),
                    audits = auditsByProperty[propertyNameAndKey],
                    propertyKey = audits[0].propertyAudit.propertyKey,
                    propertyName = audits[0].propertyAudit.propertyName;

                // TODO: support properties that were deleted
                if (propLi.length) {
                    propLi.after(auditsListTemplate({
                        audits: audits,
                        MAX_TO_DISPLAY: MAX_AUDIT_ITEMS
                    }));
                }
            });
        };

        this.createInfoJsonFromAudit = function(audit, direction) {
            var info;

            if (direction) {
                var type = audit[direction + 'Type'];

                info = {
                    'http://lumify.io#conceptType': audit[direction + 'Type'],
                    title: audit[direction + 'Title'],
                    graphVertexId: audit[direction + 'Id']
                };
            } else {
                info = {
                    _type: audit.type,
                    'http://lumify.io#conceptType': audit.subType,
                    title: audit.title,
                    graphVertexId: audit.id
                };
            }

            return JSON.stringify(info);
        };

        this.onEdgesUpdated = function(event, data) {
            var edge = _.findWhere(data.edges, { id: this.attr.data.id });
            if (edge) {
                this.attr.data.properties = edge.properties;
                this.update(edge.properties);
            }
        };

        this.onVerticesUpdated = function(event, data) {
            var vertex = _.findWhere(data.vertices, { id: this.attr.data.id });
            if (vertex) {
                this.attr.data.properties = vertex.properties;
                this.update(vertex.properties)
            }
        };

        this.onDeleteProperty = function(event, data) {
            var self = this;

            vertexService.deleteProperty(this.attr.data.id, data.property)
                .done(this.closePropertyForm.bind(this))
                .fail(this.requestFailure.bind(this, event.target))
        };

        this.onAddProperty = function(event, data) {
            if (data.property.name === 'http://lumify.io#visibilityJson') {
                if (data.isEdge) {
                    edgeService.setVisibility(
                        this.attr.data.id,
                        data.property.visibilitySource)
                        .fail(this.requestFailure.bind(this))
                        .done(this.closePropertyForm.bind(this));
                } else {
                    vertexService.setVisibility(
                        this.attr.data.id,
                        data.property.visibilitySource)
                        .fail(this.requestFailure.bind(this))
                        .done(this.closePropertyForm.bind(this));
                }
            } else {

                vertexService.setProperty(
                        this.attr.data.id,
                        data.property.key,
                        data.property.name,
                        data.property.value,
                        data.property.visibilitySource,
                        data.property.justificationText,
                        data.property.sourceInfo,
                        data.property.metadata)
                    .fail(this.requestFailure.bind(this))
                    .done(this.closePropertyForm.bind(this));
            }

        };

        this.closePropertyForm = function() {
            this.$node.find('.underneath').teardownComponent(PropertyForm);
        };

        this.requestFailure = function(request, message, error) {
            var target = this.$node.find('.underneath');
            if (_.isElement(request)) {
                target = request;
                request = arguments[1];
                message = arguments[2];
                error = arguments[3];
            }

            try {
                error = JSON.parse(error);
            } catch(e) { }

            this.trigger(target, 'propertyerror', { error: error });
        };

        this.onEditProperty = function(evt, data) {
            var root = $('<div class="underneath">'),
                property = data && data.property,
                propertyRow = property && $(evt.target).closest('tr')

            this.$node.find('button.info').popover('hide');

            if (propertyRow && propertyRow.length) {
                root.appendTo(
                    $('<tr><td colspan=3></td></tr>')
                        .insertAfter(propertyRow)
                        .find('td')
                );
            } else {
                $('<tr><td colspan="3"></td></tr>').prependTo(this.$node.find('table')).find('td').append(root);
            }

            PropertyForm.teardownAll();
            PropertyForm.attachTo(root, {
                data: this.attr.data,
                property: property
            });
        };

        this.updateJustification = function() {
            this.$node.find('.justification').each(function() {
                var justification = $(this),
                    property = justification.data('property');

                require(['util/vertex/justification/viewer'], function(JustificationViewer) {
                    var attrs = {};
                    attrs[property.name] = property.value;
                    JustificationViewer.attachTo(justification, attrs);
                });
            });
        }

        this.updateVisibility = function() {
            var self = this;

            require([
                'configuration/plugins/visibility/visibilityDisplay'
            ], function(VisibilityDisplay) {
                self.$node.find('.visibility').each(function() {
                    var visibility = $(this).data('visibility');
                    VisibilityDisplay.attachTo(this, {
                        value: visibility && visibility.source
                    })
                });
            });
        };
    }

    function onTableClick() {
        var $target = $(d3.event.target),
            $header = $target.closest('.property-group-header'),
            $tbody = $header.closest('.property-group'),
            processed = true;

        if ($header.is('.property-group-header')) {
            $tbody.toggleClass('collapsed expanded');
        } else if ($target.is('.show-more')) {
            var isShowing = $target.data('showing');
            $target.data('showing', !isShowing);
            if (isShowing) {
                delete this.showMoreExpanded[$target.data('propertyName')];
            } else {
                this.showMoreExpanded[$target.data('propertyName')] = true;
            }
            this.reload();
        } else if ($target.is('.info')) {
            var datum = d3.select($target.closest('.property-value').get(0)).datum();
            this.showPropertyInfo($target, datum.property);
        } else {
            processed = false;
        }

        if (processed) {
            d3.event.stopPropagation();
            d3.event.preventDefault();
        }
    }

    function createPropertyGroups(vertexId, ontologyProperties, showMoreExpanded, maxItemsBeforeHidden) {
        this.enter()
            .insert('tbody', '.buttons-row')
            .attr('class', function(d, groupIndex, j) {
                var cls = 'property-group collapsible';
                if (groupIndex === 0) {
                    return cls + ' expanded';
                }

                return cls + ' collapsed';
            });

        var totalPropertyCountsByName = {};

        this.selectAll('tr.property-group-header, tr.property-row')
            .data(function(pair) {
                return _.chain(pair[1])
                    .map(function(p) {
                        totalPropertyCountsByName[p[0]] = p[1].length - maxItemsBeforeHidden;
                        if (p[0] in showMoreExpanded) {
                            return p[1];
                        }
                        return p[1].slice(0, maxItemsBeforeHidden);
                    })
                    .flatten()
                    .tap(function(list) {
                        if (pair[0] !== NO_GROUP) {
                            list.splice(0, 0, [pair[0], pair[1].length]);
                        }
                    })
                    .value();
            })
            .call(
                _.partial(createProperties,
                          vertexId,
                          ontologyProperties,
                          totalPropertyCountsByName,
                          maxItemsBeforeHidden,
                          showMoreExpanded
                )
            )

        this.exit().remove();
    }

    function createProperties(vertexId,
                              ontologyProperties,
                              totalPropertyCountsByName,
                              maxItemsBeforeHidden,
                              showMoreExpanded) {

        this.enter()
            .append('tr')
            .attr('class', function(datum) {
                if (_.isString(datum[0])) {
                    return 'property-group-header';
                }
                return 'property-row property-row-' + F.className.to(datum.name + datum.key);
            });

        var currentPropertyIndex = 0, lastPropertyName = '';
        this.selectAll('td')
            .data(function(datum, i, j) {
                if (_.isString(datum[0])) {
                    return [{
                        type: GROUP,
                        name: datum[0],
                        count: datum[1]
                    }];
                }

                if (datum.name === lastPropertyName) {
                    currentPropertyIndex++;
                } else {
                    currentPropertyIndex = 0;
                    lastPropertyName = datum.name;
                }

                return [
                    {
                        type: NAME,
                        name: datum.name,
                        property: datum
                    },
                    {
                        type: VALUE,
                        property: datum,
                        propertyIndex: currentPropertyIndex,
                        showToggleLink: currentPropertyIndex === (maxItemsBeforeHidden - 1),
                        isExpanded: datum.name in showMoreExpanded,
                        hidden: Math.max(0, totalPropertyCountsByName[datum.name])
                    }
                ];
            })
            .call(_.partial(createPropertyRow, vertexId, ontologyProperties, maxItemsBeforeHidden));

        this.exit().remove();
    }

    function createPropertyRow(vertexId, ontologyProperties, maxItemsBeforeHidden) {
        this.enter()
            .append('td')
            .each(function() {
                var self = d3.select(this),
                    datum = self.datum();
                switch (datum.type) {
                    case GROUP:
                        self.append('h1')
                            .attr('class', 'collapsible-header')
                            .call(function() {
                                this.append('strong');
                                this.append('span').attr('class', 'badge');
                            });
                            break;
                    case NAME: self.append('strong'); break;
                    case VALUE:
                        self.append('span').attr('class', 'value');
                        self.append('button').attr('class', 'info')
                        self.append('span').attr('class', 'visibility');
                        if (datum.propertyIndex === (maxItemsBeforeHidden - 1)) {
                            self.append('a').attr('class', 'show-more');
                        }
                        break;
                }
            });

        this.attr('class', function(datum) {
                if (datum.type === NAME) {
                    return 'property-name';
                } else if (datum.type === VALUE) {
                    return 'property-value';
                }
            })
            .attr('width', function(datum) {
                if (datum.type === NAME) {
                    return '40%';
                }
            })
            .attr('colspan', function(datum) {
                if (datum.type === GROUP) {
                    return '3';
                } else if (datum.type === VALUE) {
                    return '2';
                }
                return '1';
            })
            .call(function() {
                var previousPropertyName = '';

                this.select('h1.collapsible-header strong').text(_.property('name'))
                this.select('h1.collapsible-header .badge')
                    .text(function(d) {
                        return F.number.pretty(d.count);
                    });

                this.select('.property-name strong')
                    .text(function(d) {
                        if (previousPropertyName === d.name) {
                            return '';
                        }
                        previousPropertyName = d.name;

                        if (isVisibility(d)) {
                            return i18n('visibility.label');
                        }

                        var ontologyProperty = ontologyProperties.byTitle[d.name];
                        if (ontologyProperty) {
                            return ontologyProperty.displayName;
                        }

                        if (d.property.displayName) {
                            return d.property.displayName;
                        }

                        console.warn('No ontology definition for ', d.name);
                        return d.name;
                    });

                this.select('.property-value .value')
                    .each(function() {
                        var self = d3.select(this),
                            property = self.datum().property,
                            valueSpan = self.node(),
                            $valueSpan = $(valueSpan),
                            visibilitySpan = $valueSpan.siblings('.visibility')[0],
                            $infoButton = $valueSpan.siblings('.info'),
                            visibility = isVisibility(property),
                            ontologyProperty = ontologyProperties.byTitle[property.name],
                            dataType = ontologyProperty && ontologyProperty.dataType,
                            displayType = ontologyProperty && ontologyProperty.displayType;

                        valueSpan.textContent = '';
                        visibilitySpan.textContent = '';

                        if (visibility) {
                            dataType = 'visibility';
                        } else if (property.hideVisibility !== true) {
                            F.vertex.properties.visibility(
                                visibilitySpan, { value: property[VISIBILITY_NAME] }, vertexId);
                        }

                        $infoButton.toggle(Boolean(
                            !property.hideInfo &&
                            (Privileges.canEDIT || F.vertex.hasMetadata(property))
                        ));

                        if (displayType && F.vertex.properties[displayType]) {
                            F.vertex.properties[displayType](valueSpan, property, vertexId);
                            return;
                        } else if (dataType && F.vertex.properties[dataType]) {
                            F.vertex.properties[dataType](valueSpan, property, vertexId);
                            return;
                        }

                        if (isJustification(property)) {
                            require(['util/vertex/justification/viewer'], function(JustificationViewer) {
                                $(valueSpan).teardownAllComponents();
                                JustificationViewer.attachTo(valueSpan, property.justificationData);
                            });
                            return;
                        }

                        valueSpan.textContent = F.vertex.displayProp(property);
                    });

                this.select('.property-value .show-more')
                    .attr('data-property-name', function(d) {
                        return d.property.name;
                    })
                    .text(function(d) {
                        return i18n(
                            'properties.button.' + (d.isExpanded ? 'hide_more' : 'show_more'),
                            F.number.pretty(d.hidden),
                            ontologyProperties.byTitle[d.property.name].displayName
                        );
                    })
                    .style('display', function(d) {
                        if (d.showToggleLink && d.hidden > 0) {
                            return 'block';
                        }

                        return 'none';
                    });
            })

        this.exit().remove();
    }

});
