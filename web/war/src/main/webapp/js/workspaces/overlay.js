
define([
    'flight/lib/component',
    'tpl!./overlay',
    'util/formatters',
    'service/workspace',
    'service/ontology',
    'data'
], function(defineComponent, template, F, WorkspaceService, OntologyService, appData) {
    'use strict';

    var LAST_SAVED_UPDATE_FREQUENCY_SECONDS = 30,
        MENUBAR_WIDTH = 30,
        UPDATE_WORKSPACE_DIFF_SECONDS = 3,
        SHOW_UNPUBLUSHED_CHANGES_SECONDS = 3;

    return defineComponent(WorkspaceOverlay);

    function isWorkspaceDiffPost(settings) {
        var route = ~['workspace/undo', 'workspace/publish'].indexOf(settings.url),
            isPost = (/post/i).test(settings.type);

        return !!(route && isPost);
    }

    function WorkspaceOverlay() {

        var workspaceService = new WorkspaceService(),
            ontologyService = new OntologyService();

        this.defaultAttrs({
            userSelector: '.user',
            nameSelector: '.name',
            subtitleSelector: '.subtitle'
        });

        this.after('initialize', function() {
            var self = this;

            requestAnimationFrame(function() {
                MENUBAR_WIDTH = $('.menubar-pane').width();
            })

            this.userDeferred = $.Deferred();
            if (window.currentUser) {
                this.userDeferred.resolve();
            }

            this.workspaceDeferred = $.Deferred();
            this.updateDiffBadge = _.throttle(this.updateDiffBadge.bind(this), UPDATE_WORKSPACE_DIFF_SECONDS * 1000)

            $.when(this.userDeferred, this.workspaceDeferred).done(function() {
                self.$node.show();

                self.updateUserTooltip({user: window.currentUser});

                requestAnimationFrame(function() {
                    self.$node.addClass('visible');
                });
            })

            this.$node.hide().html(template({}));

            this.on(document, 'workspaceSaving', this.onWorkspaceSaving);
            this.on(document, 'workspaceSaved', this.onWorkspaceSaved);
            this.on(document, 'workspaceLoaded', this.onWorkspaceLoaded);
            this.on(document, 'switchWorkspace', this.onSwitchWorkspace);
            this.on(document, 'graphPaddingUpdated', this.onGraphPaddingUpdated);
            this.on(document, 'currentUserChanged', this.onCurrentUserChanged);
            this.on(document, 'relationshipsLoaded', this.onRelationshipsLoaded);

            this.on(document, 'verticesUpdated', this.updateDiffBadge);
            this.on(document, 'verticesAdded', this.updateDiffBadge);
            this.on(document, 'edgesDeleted', this.updateDiffBadge);
            this.on(document, 'updateDiff', this.updateDiffBadge);

            this.on(document, 'showDiffPanel', this.showDiffPanel);
            this.on(document, 'escape', this.closeDiffPanel);

            this.trigger(document, 'registerKeyboardShortcuts', {
                scope: ['graph.help.scope', 'map.help.scope'].map(i18n),
                shortcuts: {
                    'alt-d':  { fire: 'showDiffPanel', desc: i18n('workspaces.help.show_diff') }
                }
            });
        });

        this.showDiffPanel = function() {
            var badge = this.$node.find('.badge');
            if (badge.is(':visible')) {
                badge.popover('show');
            }
        };

        this.closeDiffPanel = function() {
            var badge = this.$node.find('.badge');
            if (badge.is(':visible')) {
                badge.popover('hide');
            }
        };

        this.onCurrentUserChanged = function(event, data) {
            this.userDeferred.resolve();
            this.updateUserTooltip(data);
        }

        this.onGraphPaddingUpdated = function(event, data) {
            this.$node.css('left', data.padding.l + MENUBAR_WIDTH);

            var width = $(window).width(),
                height = $(window).height(),
                popover = this.$node.find('.popover'),
                paddingH = 100,
                paddingV = 75,
                popoverCss = {
                    maxWidth: (width - MENUBAR_WIDTH - (data.padding.l + data.padding.r) - paddingH),
                    maxHeight: (height - (data.padding.t + data.padding.b) - paddingV)
                };

            this.popoverCss = popoverCss;
            if (popover.length) {
                this.updatePopoverSize(popover);
            }
        };

        this.updatePopoverSize = function(tip) {
            var css = {};
            if (tip.width() > this.popoverCss.maxWidth) {
                css.width = this.popoverCss.maxWidth + 'px';
            }
            if (tip.height() > this.popoverCss.maxHeight) {
                css.height = this.popoverCss.maxHeight + 'px';
            }

            tip.resizable('option', 'maxWidth', this.popoverCss.maxWidth);
            tip.resizable('option', 'maxHeight', this.popoverCss.maxHeight);
            if (_.keys(css).length) {
                tip.css(css);
            }
        }

        this.setContent = function(title, editable, subtitle) {
            this.select('nameSelector').text(title);
            this.select('subtitleSelector').html(
                editable === false ?
                    i18n('workspaces.overlay.read_only') :
                    subtitle
            );
        };

        this.onSwitchWorkspace = function() {
            this.previousDiff = null;
            this.$node.find('.badge').popover('destroy').remove();
        };

        this.onWorkspaceLoaded = function(event, data) {
            this.workspaceDeferred.resolve();
            this.setContent(data.title, data.editable, i18n('workspaces.overlay.no_changes'));
            clearTimeout(this.updateTimer);
            this.updateWorkspaceTooltip(data);
            this.updateDiffBadge();
        };

        this.onRelationshipsLoaded = function(event, data) {
            this.updateWorkspaceTooltip(data);
        };

        this.onWorkspaceSaving = function(event, data) {
            this.select('subtitleSelector').text(i18n('workspaces.overlay.saving'));
            clearTimeout(this.updateTimer);
            this.updateWorkspaceTooltip(data);
        };

        this.onWorkspaceSaved = function(event, data) {
            clearTimeout(this.updateTimer);
            this.lastSaved = F.date.utc(Date.now());

            if (data.title) {
                this.select('nameSelector').text(data.title);
            }

            this.updateWorkspaceTooltip(data);

            var subtitle = this.select('subtitleSelector').text(
                    i18n('workspaces.overlay.last_saved_moments_ago')
                ),
                setTimer = function() {
                    this.updateTimer = setTimeout(function() {

                        var time = F.date.relativeToNow(this.lastSaved);
                        subtitle.text(
                            i18n('workspaces.overlay.last_saved_time', time)
                        );

                        setTimer();
                    }.bind(this), LAST_SAVED_UPDATE_FREQUENCY_SECONDS * 1000);
                }.bind(this);

            setTimer();
        };

        this.onDiffBadgeMouse = function(event) {
            this.trigger(
                event.type === 'mouseenter' ?  'focusVertices' : 'defocusVertices',
                { vertexIds: this.currentDiffIds || [] }
            );
        };

        this.updateDiffBadge = function(event, data) {
            var self = this,
                node = this.select('nameSelector'),
                badge = this.$node.find('.badge');

            if (event && event.type === 'verticesUpdated') {
                if (!data || !data.options || data.options.originalEvent !== 'propertiesChange') {
                    return;
                }
            }

            if (!badge.length) {
                badge = $('<span class="badge"></span>')
                    .insertAfter(node)
                    .on('mouseenter mouseleave', this.onDiffBadgeMouse.bind(this))
            }

            $.when(
                workspaceService.diff(appData.workspaceId),
                ontologyService.properties())
                .fail(function() {
                    badge.removePrefixedClasses('badge-').addClass('badge-important')
                        .popover('destroy')
                        .attr('title', i18n('workspaces.overlay.error'))
                        .text('!');
                })
                .done(function(response, ontologyProperties) {
                    var diffs = response[0].diffs,
                        diffsWithoutVisibleProperty = _.map(diffs, function(d) {
                            return _.omit(d, 'visible');
                        });

                    // Check if same
                    if (self.previousDiff && _.isEqual(diffsWithoutVisibleProperty, self.previousDiff)) {
                        return;
                    }
                    self.previousDiff = diffsWithoutVisibleProperty;

                    var vertexDiffsById = _.indexBy(diffs, function(diff) {
                            return diff.vertexId;
                        }),
                        countOfTitleChanges = 0,
                        filteredDiffs = _.filter(diffs, function(diff) {
                            if (diff.type !== 'PropertyDiffItem') return true;

                            var ontologyProperty = ontologyProperties.byTitle[diff.name];
                            if (!ontologyProperty || !ontologyProperty.userVisible) return false;
                            if (diff.name === 'title' && vertexDiffsById[diff.elementId]) {
                                countOfTitleChanges++;
                            }
                            return true;
                        }),
                        count = filteredDiffs.length - countOfTitleChanges,
                        formattedCount = F.number.pretty(count);

                    self.currentDiffIds = _.uniq(filteredDiffs.map(function(diff) {
                        return diff.vertexId || diff.elementId || diff.edgeId;
                    }));

                    require(['workspaces/diff/diff'], function(Diff) {
                        var popover = badge.data('popover'),
                            tip = popover && popover.tip();

                        if (tip && tip.is(':visible')) {
                            self.trigger(popover.tip().find('.popover-content'),
                                 'diffsChanged',
                                 { diffs: filteredDiffs });
                            popover.show();
                        } else {
                            badge
                                .popover('destroy')
                                .popover({
                                    placement: 'top',
                                    content: i18n('workspaces.diff.loading'),
                                    title: i18n('workspaces.diff.header.unpublished_changes')
                                });

                            popover = badge.data('popover');
                            tip = popover.tip();

                            var left = 10;
                            tip.css({
                                    width: '400px',
                                    height: '250px'
                                })
                                .data('sizePreference', 'diff')
                                .find('.arrow').css({
                                    left: parseInt(badge.position().left - (left / 2) + 1, 10) + 'px',
                                    marginLeft: 0
                                })

                            // We fill in our own content
                            popover.setContent = function() {}
                            badge.on('shown', function() {
                                var css = {
                                    top: (parseInt(tip.css('top')) - 10) + 'px'
                                };
                                tip.resizable({
                                    handles: 'n, e, ne',
                                    maxWidth: self.popoverCss.maxWidth,
                                    maxHeight: self.popoverCss.maxHeight
                                }).css({top: top});

                                self.updatePopoverSize(tip);
                            })

                            Diff.teardownAll();
                            Diff.attachTo(tip.find('.popover-content'), {
                                diffs: filteredDiffs
                            });
                        }
                    });

                    badge.removePrefixedClasses('badge-').addClass('badge-info')
                        .attr('title', i18n('workspaces.diff.unpublished_change.' + (
                            formattedCount === 1 ?
                            'one' : 'some'), formattedCount))
                        .text(count > 0 ? formattedCount : '');

                    if (count > 0) {
                        self.animateBadge(badge, formattedCount);
                    } else if (count === 0) {
                        badge.popover('destroy');
                    }
                })
        };

        var badgeReset, animateTimer;
        this.animateBadge = function(badge, formattedCount) {
            badge.text(formattedCount).css('width', 'auto');

            var previousWidth = badge.width(),
                html = formattedCount + ' <span>' + i18n('workspaces.diff.unpublished') + '</span>',
                findWidth = function() {
                    return (
                        badge[0].scrollWidth - (
                        parseInt(badge.css('paddingLeft'),10) + parseInt(badge.css('paddingRight'),10)
                        )
                    ) + 'px';
                };

            if (animateTimer) {
                clearTimeout(animateTimer);
                animateTimer = _.delay(
                    badgeReset.bind(null, previousWidth, formattedCount),
                    SHOW_UNPUBLUSHED_CHANGES_SECONDS * 1000
                );
                return badge.html(html).css({ width: findWidth() })
            }

            badge.css({
                width: previousWidth + 'px',
                backgroundColor: '#0088cc',
                transition: 'all cubic-bezier(.29,.79,0,1.48) 0.5s',
                overflow: 'hidden',
                position: 'relative',
                top: '4px'
            }).html(html);

            badge.css({
                backgroundColor: '#1ab2ff',
                width: findWidth()
            }).find('span').css({
                transition: 'opacity ease-out 0.5s',
            })

            animateTimer = _.delay((badgeReset = function(previousWidth, formattedCount) {
                animateTimer = null;
                badge.on(TRANSITION_END, function(e) {
                    if (e.originalEvent.propertyName === 'width') {
                        badge.off(TRANSITION_END);
                        badge.text(formattedCount).css('width', 'auto');
                    }
                }).css({
                    transition: 'all cubic-bezier(.92,-0.42,.37,1.31) 0.5s',
                    backgroundColor: '#0088cc',
                    width: previousWidth + 'px'
                }).find('span').css('opacity',0);
            }).bind(null, previousWidth, formattedCount), SHOW_UNPUBLUSHED_CHANGES_SECONDS * 1000);
        };

        this.updateUserTooltip = function(data) {
            if (data && data.user) {
                this.select('userSelector').text(data.user.displayName)
                    .tooltip('destroy')
                    .tooltip({
                        placement: 'right',
                        html: true,
                        title: '<span><strong>' +
                            i18n('workspaces.overlay.authorizations') +
                            '</strong> ' +
                                    (data.user.authorizations.join(', ') ||
                                     i18n('workspaces.overlay.authorizations.none')) +
                                '</span>' +
                                '<div><strong>' +
                                i18n('workspaces.overlay.privileges') +
                                '</strong> ' +
                                    _.without(data.user.privileges, 'READ').join(', ') +
                                '</div>',
                        trigger: 'hover',
                        delay: { show: 500, hide: 0 }
                    })
            }
        }

        this.updateWorkspaceTooltip = function(data) {
            if (data && data.data && data.data.vertices) {
                this.verticesCount = data.data.vertices.length;
            }
            if (this.verticesCount === 0) {
                this.edgesCount = 0;
            } else if (data.relationships) {
                this.edgesCount = data.relationships.length;
            } else {
                this.edgesCount = $('.cytoscape-container').cytoscape('get').edges().length;
            }

            var name = this.select('nameSelector'),
                tooltip = name.data('tooltip'),
                tip = tooltip && tooltip.tip(),
                text = i18n('workspaces.overlay.vertices') + ': ' +
                    F.number.pretty(this.verticesCount || 0) + ', ' +
                    i18n('workspaces.overlay.edges') + ': ' +
                    F.number.pretty(this.edgesCount || 0)

            if (tip && tip.is(':visible')) {
                tip.find('.tooltip-inner span').text(text);
            } else {
                name
                    .tooltip('destroy')
                    .tooltip({
                        placement: 'right',
                        html: true,
                        title: '<span style="white-space:nowrap">' + text + '</span>',
                        trigger: 'hover',
                        delay: { show: 500, hide: 0 }
                    });
            }

        }
    }
});
