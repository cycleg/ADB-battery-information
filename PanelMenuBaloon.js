const { Clutter, Gio, GLib, GObject, Meta, Shell, St } = imports.gi;
const Main = imports.ui.main;

const PANEL_MENU_BALOON_SHOW_TIME = 0.15;
const PANEL_MENU_BALOON_HIDE_TIME = 0.1;

var PanelMenuBaloon = GObject.registerClass(
class PanelMenuBaloon extends St.Label {
    _init(parent, text, params) {
        super._init(params);
        this._parent = parent;
        this.set_text(text);
        Main.layoutManager.addChrome(this);
        this.hide();
        this._parent.actor.connect(
            'notify::hover',
            this._onHoverChanged.bind(this)
        );
        this._parent.actor.opacity = 207;
    }

    _onHoverChanged(actor) {
        actor.opacity = actor.hover ? 255 : 207;
    }

    showLabel() {
        this.opacity = 0;
        this.show();

        let [screenWidth, screenHeight] = ('get_backend' in Meta) ?
            Meta.get_backend().get_stage().get_size() :
            global.backend.get_stage().get_size();
        let [stageX, stageY] = this._parent.actor.get_transformed_position();

        let labelWidth = this.get_width();

        let node = this.get_theme_node();
        let xOffset = node.get_length('-x-offset');
        let yOffset = node.get_length('-y-offset');

        let parentWidth = this._parent.allocation.x2 - this._parent.allocation.x1;
        let parentHeight = this._parent.allocation.y2 - this._parent.allocation.y1;

        let textDirectionLeft = Clutter.get_default_text_direction() == Clutter.TextDirection.LTR;
        let y = stageY + (parentHeight + yOffset) * (stageY + parentHeight + 1 >= screenHeight ?  -1 : 1);
        let x = stageX + parentWidth < screenWidth / 2 ?
                textDirectionLeft ? stageX + xOffset : stageX + parentWidth - xOffset :
                stageX + parentWidth - labelWidth - xOffset;

        if (textDirectionLeft) {
            // stop long tooltips falling off the right of the screen
            x = x + labelWidth > screenWidth ? screenWidth - labelWidth - xOffset : x;
        }
        else {
            x = x - labelWidth < 0 ? xOffset : x;
        }

        this.set_position(x, y);
        this.remove_all_transitions();
        this.ease({
            opacity: 255,
            duration: PANEL_MENU_BALOON_SHOW_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
       });
    }

    hideLabel() {
        this.opacity = 255;
        this.remove_all_transitions();
        this.ease({
            opacity: 0,
            duration: PANEL_MENU_BALOON_HIDE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.hide()
        });
    }
});
