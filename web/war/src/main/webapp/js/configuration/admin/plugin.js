/**
 * Base plugin file that defines a lumify admin ui plugin.
 */
define([
    'flight/lib/component',
    'flight/lib/registry',
    'service/admin',
    'tpl!util/alert',
    'util/messages',
    'util/formatters',
    'util/handlebars/helpers'
], function(defineComponent,
    registry,
    AdminService,
    alertTemplate,
    i18n,
    F) {
    'use strict';

    var NODE_CLS_FOR_LESS_CONTAINMENT = 'admin_less_cls_',
        adminService = new AdminService(),
        componentInc = 0;

    defineLumifyAdminPlugin.ALL_COMPONENTS = [];

    return defineLumifyAdminPlugin;

    function defineLumifyAdminPlugin(Component, options) {

        var FlightComponent = defineComponent(Component),
            attachTo = FlightComponent.attachTo,
            cls = NODE_CLS_FOR_LESS_CONTAINMENT + (componentInc++);

        if (options && options.less) {
            options.less.applyStyleForClass(cls);
        }

        FlightComponent.attachTo = function attachToWithLessClass(selector) {
            $(selector).each(function() {
                $(this).addClass(cls)
            });

            var self = this;
            this.prototype.initialize = _.wrap(this.prototype.initialize, function(init) {
                this.adminService = adminService;
                this.showSuccess = function(message) {
                    this.$node.find('.alert').remove();
                    this.$node.prepend(alertTemplate({ message: message || i18n('admin.plugin.success') }));
                };
                this.showError = function(message) {
                    this.$node.find('.alert').remove();
                    this.$node.prepend(alertTemplate({ error: message || i18n('admin.plugin.error') }));
                };
                this.handleSubmitButton = function(button, promise) {
                    var text = button.text();

                    button.attr('disabled', true);

                    return promise
                        .progress(function(v) {
                            button.text(F.number.percent(v) + ' ' + text);
                        })
                        .always(function() {
                            button.removeAttr('disabled').text(text);
                        });
                };
                return init.apply(this, Array.prototype.slice.call(arguments, 1));
            });
            attachTo.apply(this, arguments);
        }

        componentInc++;

        defineLumifyAdminPlugin.ALL_COMPONENTS.push(
            $.extend({},
                _.pick(options || {}, 'section', 'name', 'subtitle'),
                {
                    Component: FlightComponent
                }
            )
        );

        return FlightComponent;
    }
});
