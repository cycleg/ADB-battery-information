var DeviceInfo = class {
    constructor() {
        this._model = "";
        this.clean()
    }

    clean() {
        this._beginTimestamp = 0;
        this._refreshTimestamp = 0;
        this._beginBatteryLevel = -1;
        this._prevBatteryLevel = -1;
        this._lastEstimation = "";
        this._cleaned = true;
    }

    get beginBatteryLevel() {
        return this._beginBatteryLevel;
    }

    set beginBatteryLevel(level) {
        this._cleaned = this._cleaned || (level !== -1);
        this._beginBatteryLevel = level;
    }

    get beginTimestamp() {
        return this._beginTimestamp;
    }

    set beginTimestamp(timestamp) {
        this._cleaned = this._cleaned || (timestamp !== 0);
        this._beginTimestamp = timestamp;
    }

    get cleaned() {
        return this._cleaned;
    }

    get lastEstimation() {
        return this._lastEstimation;
    }

    set lastEstimation(estimation) {
        this._cleaned = this._cleaned || (estimation !== "");
        this._lastEstimation = estimation;
    }

    get model() {
        return this._model;
    }

    set model(model) {
        this._model = model;
    }

    get prevBatteryLevel() {
        return this._prevBatteryLevel;
    }

    set prevBatteryLevel(level) {
        this._cleaned = this._cleaned || (level !== -1);
        this._prevBatteryLevel = level;
    }

    get refreshTimestamp() {
        return this._beginTimestamp;
    }

    set refreshTimestamp(timestamp) {
        this._cleaned = this._cleaned || (timestamp !== 0);
        this._refreshTimestamp = timestamp;
    }
};