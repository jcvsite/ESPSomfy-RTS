// Local file:// debug only — SoftAP default. Leave blank host unused when served from the device.
var hst = '192.168.4.1';

var _rooms = [];
let LANG = {};
var baseUrl = window.location.protocol === 'file:' ? `http://${hst}` : '';
var waitLoad;
var mouseDown = false;
const get = id => document.getElementById(id);

const closeOverlay = (div, callback) => {
    if (!div) return;
    if (typeof firmware !== 'undefined' && firmware.isUpdateBusy && firmware.isUpdateBusy()) {
        // Block accidental dismiss while FW/FS flash is in progress.
        if (div.id === 'divUploadFile' || div.id === 'divGitInstall') return;
    }
    if (typeof callback === 'function') callback();
    div.classList.add('overlay-exit');
    setTimeout(() => div.remove(), 300);
};
if (typeof ui !== 'undefined' && ui.waitMessage) {
    waitLoad = ui.waitMessage(document.body);
}
window.tr = function(id) {
    return (LANG && LANG[id]) ? LANG[id] : id;
};
const REBOOT_WAIT_FALLBACK = 'Rebooting… please wait';
const translator = {
    isInitialized: false,
    observer: null,

    translate(el) {
        const key = el.getAttribute('tr');
        if (!key) return;

        const text = tr(key);
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.placeholder = text;
        } else if (el.hasAttribute('title')) {
            el.title = text;
        } else {
            el.textContent = text;
        }
    },
    init() {
        document.querySelectorAll('[tr]').forEach(el => this.translate(el));
        if (this.isInitialized) return;

        this.observer = new MutationObserver((mutations) => {
            mutations.forEach(m => m.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    if (node.hasAttribute('tr')) this.translate(node);
                    node.querySelectorAll('[tr]').forEach(el => this.translate(el));
                }
            }));
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
        this.isInitialized = true;
    }
};
function loadLang(callback) {
    if (Object.keys(LANG).length > 2) {
        if (callback) callback();
        return;
    }
    const applyDict = (dict) => {
        LANG = dict && typeof dict === 'object' ? dict : {};
        translator.init();
        finishLoad(callback);
    };
    fetch(baseUrl + '/lang?_=' + Date.now())
    .then(r => {
        if (!r.ok) throw new Error('lang HTTP ' + r.status);
        return r.json();
    })
    .then(dict => {
        if (!dict || !dict.WELCOME) throw new Error('lang missing keys');
        applyDict(dict);
    })
    .catch(err => {
        console.error("Language load failed", err);
        // Minimal fallback so the UI is usable until LittleFS is re-flashed
        applyDict({
            BT_LOGIN: "Login",
            HOME: "Home",
            WELCOME: "Finish setup",
            WELCOME_EMPTY_TITLE: "No motors yet",
            WELCOME_DESC: "Connect network and radio, then restore a backup or add a shade.",
            WELCOME_DESC_READY: "Restore a backup after a failed update, or add a new shade.",
            WELCOME_NET_DESC: "Connect to Wi-Fi or Ethernet",
            WELCOME_NET_DONE: "Connected",
            WELCOME_RAD_DESC: "Match the radio to your motors (usually 433.42 MHz)",
            WELCOME_RAD_DONE: "Radio configured",
            WELCOME_SYS_DESC: "Theme, login, and firmware updates",
            WELCOME_MOTORS_TITLE: "Motors",
            WELCOME_MOTORS_DESC: "No shades yet — restore a backup or add a new device.",
            WELCOME_ADD_SHADE_TITLE: "Add a device",
            WELCOME_ADD_SHADE_DESC: "Pair a shade, blind, gate, or garage",
            WELCOME_FOOTER_NOTE: "Hides after you add a room, device, or group.",
            TAB_NETWORK: "Network",
            TAB_RADIO: "Radio",
            TAB_SYSTEM: "System",
            MSG_REBOOTING: REBOOT_WAIT_FALLBACK,
            MSG_RECONNECTING: "Reconnecting… please wait",
            PROMPT_REBOOT_CONFIRM: "Are you sure you want to reboot the device?",
            BT_YES: "Yes",
            BT_NO: "No",
            BT_OK: "OK",
            BT_CLOSE: "Close"
        });
    });
}
function finishLoad(callback) {
    document.body.classList.add('lang-loaded');
    const splash = document.getElementById('appSplash');
    if (splash) setTimeout(() => splash.remove(), 400);
    if (waitLoad && typeof waitLoad.remove === 'function') {
        waitLoad.remove();
    }
    if (callback) callback();
}
function displayUptime(totalSeconds, className) {
    const elements = document.querySelectorAll('.' + className);
    if (elements.length === 0 || isNaN(totalSeconds)) return;

    let seconds = parseInt(totalSeconds, 10);
    let days = Math.floor(seconds / (24 * 3600));
    seconds %= (24 * 3600);
    let hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    let minutes = Math.floor(seconds / 60);

    const fH = hours.toString().padStart(2, '0');
    const fM = minutes.toString().padStart(2, '0');
    const timeString = `${days}${tr('DAY')} ${fH}${tr('HOUR')} ${fM}${tr('MIN')}`;

    elements.forEach(el => {
        el.textContent = timeString;
    });
}
function renderUptimeChip(totalSeconds) {
    const daysEl = get('upDays');
    const hoursEl = get('upHours');
    const minsEl = get('upMins');
    if (!daysEl || !hoursEl || !minsEl || isNaN(totalSeconds)) return;
    let seconds = Math.max(0, parseInt(totalSeconds, 10));
    const days = Math.floor(seconds / (24 * 3600));
    seconds %= (24 * 3600);
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    daysEl.textContent = String(days);
    hoursEl.textContent = String(hours).padStart(2, '0');
    minsEl.textContent = String(minutes).padStart(2, '0');
    const chip = get('divUptimeChip');
    if (chip) chip.title = `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}
const uptimeClock = {
    deviceBase: null,
    netBase: null,
    receivedAt: 0,
    timer: null,
    set(deviceSec, netSec) {
        if (!isNaN(deviceSec)) this.deviceBase = parseInt(deviceSec, 10);
        if (!isNaN(netSec)) this.netBase = parseInt(netSec, 10);
        this.receivedAt = Date.now();
        this.render();
        if (!this.timer) this.timer = setInterval(() => this.render(), 1000);
    },
    render() {
        if (this.deviceBase == null && this.netBase == null) return;
        const elapsed = Math.floor((Date.now() - this.receivedAt) / 1000);
        if (this.deviceBase != null) {
            const total = this.deviceBase + elapsed;
            displayUptime(total, 'uptime-display');
            renderUptimeChip(total);
        }
        if (this.netBase != null) displayUptime(this.netBase + elapsed, 'net-display');
    }
};
var errors = [
    { code: -10, key: 'ERR_PIN_TRANSCEIVER' },
    { code: -11, key: 'ERR_PIN_ETHERNET' },
    { code: -12, key: 'ERR_PIN_MOTOR' },
    { code: -21, key: 'ERR_GIT_FLASH_WRITE' },
    { code: -22, key: 'ERR_GIT_FLASH_ERASE' },
    { code: -23, key: 'ERR_GIT_FLASH_READ' },
    { code: -24, key: 'ERR_GIT_SPACE' },
    { code: -25, key: 'ERR_GIT_FILE_SIZE' },
    { code: -26, key: 'ERR_GIT_TIMEOUT' },
    { code: -27, key: 'ERR_GIT_MD5' },
    { code: -28, key: 'ERR_GIT_MAGIC_BYTE' },
    { code: -29, key: 'ERR_GIT_ACTIVATE' },
    { code: -30, key: 'ERR_GIT_PARTITION' },
    { code: -31, key: 'ERR_GIT_ARGUMENT' },
    { code: -32, key: 'ERR_GIT_ABORTED' },
    { code: -40, key: 'ERR_GIT_HTTP' },
    { code: -41, key: 'ERR_GIT_BUFFER' },
    { code: -42, key: 'ERR_GIT_CONNECT' },
    { code: -43, key: 'ERR_GIT_DL_TIMEOUT' }
].map(err => {

    return {
        code: err.code,
        key: err.key,
        get desc() { return tr(this.key); }
    };
});
document.oncontextmenu = (event) => {
    if (event.target && event.target.tagName.toLowerCase() === 'input' && (event.target.type.toLowerCase() === 'text' || event.target.type.toLowerCase() === 'password'))
        return;
    else {
        event.preventDefault(); event.stopPropagation(); return false;
    }
};
Date.prototype.toJSON = function () {
    const tz = this.getTimezoneOffset();
    const sign = tz > 0 ? '-' : '+';
    const absTz = Math.abs(tz);
    const f = (n, c) => n.toString().padStart(c, '0');

    return `${this.getFullYear()}-${f(this.getMonth() + 1, 2)}-${f(this.getDate(), 2)}T${f(this.getHours(), 2)}:${f(this.getMinutes(), 2)}:${f(this.getSeconds(), 2)}.${f(this.getMilliseconds(), 3)}${sign}${f(Math.floor(absTz / 60), 2)}${f(absTz % 60, 2)}`;
};
Date.prototype.fmt = function (fmtMask, emptyMask) {
    const mask = fmtMask || 'MM-dd-yyyy HH:mm:ss';
    if (mask.match(/[hHmt]/) && this.isDateTimeEmpty?.()) return emptyMask ?? '';
    if (mask.match(/[Mdy]/) && this.isDateEmpty?.()) return emptyMask ?? '';

    const d = this;
    const y = d.getFullYear();
    const H = d.getHours();
    const m = d.getMonth();
    const map = {
        yyyy: y,
        yy: String(y).slice(-2),
        MMMM: formatType.MONTHS[m],
        MMM: formatType.MONTHS[m]?.substring(0, 3),
        MM: String(m + 1).padStart(2, '0'),
        M: m + 1,
        dddd: formatType.DAYS[d.getDay()],
        ddd: formatType.DAYS[d.getDay()]?.substring(0, 3),
        dd: String(d.getDate()).padStart(2, '0'),
        d: d.getDate(),
        HH: String(H).padStart(2, '0'),
        H: H,
        hh: String(H % 12 || 12).padStart(2, '0'),
        h: (H % 12 || 12),
        mm: String(d.getMinutes()).padStart(2, '0'),
        m: d.getMinutes(),
        ss: String(d.getSeconds()).padStart(2, '0'),
        s: d.getSeconds(),
        tt: H < 12 ? 'am' : 'pm',
        t: H < 12 ? 'a' : 'p'
    };

    return mask.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|tt|t/g, t => map[t]);
};
Number.prototype.round = function (dec) { return Number(Math.round(this + 'e' + dec) + 'e-' + dec); };
Number.prototype.fmt = function (format, empty) {
    if (isNaN(this)) return empty || '';
    if (typeof format === 'undefined') return this.toString();
    let isNegative = this < 0;
    let tok = ['#', '0'];
    let pfx = '', sfx = '', fmt = format.replace(/[^#\.0\,]/g, '');
    let dec = fmt.lastIndexOf('.') > 0 ? fmt.length - (fmt.lastIndexOf('.') + 1) : 0,
    fw = '', fd = '', vw = '', vd = '', rw = '', rd = '';
    let val = String(Math.abs(this).round(dec));
    let ret = '', commaChar = ',', decChar = '.';
    for (var i = 0; i < format.length; i++) {
        let c = format.charAt(i);
        if (c === '#' || c === '0' || c === '.' || c === ',')
            break;
        pfx += c;
    }
    for (let i = format.length - 1; i >= 0; i--) {
        let c = format.charAt(i);
        if (c === '#' || c === '0' || c === '.' || c === ',')
            break;
        sfx = c + sfx;
    }
    if (dec > 0) {
        let dp = val.lastIndexOf('.');
        if (dp === -1) {
            val += '.'; dp = 0;
        }
        else
            dp = val.length - (dp + 1);
        while (dp < dec) {
            val += '0';
            dp++;
        }
        fw = fmt.substring(0, fmt.lastIndexOf('.'));
        fd = fmt.substring(fmt.lastIndexOf('.') + 1);
        vw = val.substring(0, val.lastIndexOf('.'));
        vd = val.substring(val.lastIndexOf('.') + 1);
        let ds = val.substring(val.lastIndexOf('.'), val.length);
        for (let i = 0; i < fd.length; i++) {
            if (fd.charAt(i) === '#' && vd.charAt(i) !== '0') {
                rd += vd.charAt(i);
                continue;
            } else if (fd.charAt(i) === '#' && vd.charAt(i) === '0') {
                var np = vd.substring(i);
                if (np.match('[1-9]')) {
                    rd += vd.charAt(i);
                    continue;
                }
                else
                    break;
            }
            else if (fd.charAt(i) === '0' || fd.charAt(i) === '#')
                rd += vd.charAt(i);
        }
        if (rd.length > 0) rd = decChar + rd;
    }
    else {
        fw = fmt;
        vw = val;
    }
    var cg = fw.lastIndexOf(',') >= 0 ? fw.length - fw.lastIndexOf(',') - 1 : 0;
    var nw = Math.abs(Math.floor(this.round(dec)));
    if (!(nw === 0 && fw.substr(fw.length - 1) === '#') || fw.substr(fw.length - 1) === '0') {
        var gc = 0;
        for (let i = vw.length - 1; i >= 0; i--) {
            rw = vw.charAt(i) + rw;
            gc++;
            if (gc === cg && i !== 0) {
                rw = commaChar + rw;
                gc = 0;
            }
        }
        if (fw.length > rw.length) {
            var pstart = fw.indexOf('0');
            if (pstart >= 0) {
                var plen = fw.length - pstart;
                var pos = fw.length - rw.length - 1;
                while (rw.length < plen) {
                    let pc = fw.charAt(pos);
                    if (pc === ',') pc = commaChar;
                    rw = pc + rw;
                    pos--;
                }
            }
        }
    }
    if (isNegative) rw = '-' + rw;
    if (rd.length === 0 && rw.length === 0) return '';
    return pfx + rw + rd + sfx;
};
function makeBool(val) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'undefined') return false;
    if (typeof val === 'number') return val >= 1;
    if (typeof val === 'string') {
        if (val === '') return false;
        switch (val.toLowerCase().trim()) {
            case 'on':
            case 'true':
            case 'yes':
            case 'y':
                return true;
            case 'off':
            case 'false':
            case 'no':
            case 'n':
                return false;
        }
        if (!isNaN(parseInt(val, 10))) return parseInt(val, 10) >= 1;
    }
    return false;
}
var httpStatusText = {
    '200': 'OK',
    '201': 'Created',
    '202': 'Accepted',
    '203': 'Non-Authoritative Information',
    '204': 'No Content',
    '205': 'Reset Content',
    '206': 'Partial Content',
    '300': 'Multiple Choices',
    '301': 'Moved Permanently',
    '302': 'Found',
    '303': 'See Other',
    '304': 'Not Modified',
    '305': 'Use Proxy',
    '306': 'Unused',
    '307': 'Temporary Redirect',
    '400': 'Bad Request',
    '401': 'Unauthorized',
    '402': 'Payment Required',
    '403': 'Forbidden',
    '404': 'Not Found',
    '405': 'Method Not Allowed',
    '406': 'Not Acceptable',
    '407': 'Proxy Authentication Required',
    '408': 'Request Timeout',
    '409': 'Conflict',
    '410': 'Gone',
    '411': 'Length Required',
    '412': 'Precondition Required',
    '413': 'Request Entry Too Large',
    '414': 'Request-URI Too Long',
    '415': 'Unsupported Media Type',
    '416': 'Requested Range Not Satisfiable',
    '417': 'Expectation Failed',
    '418': 'I\'m a teapot',
    '429': 'Too Many Requests',
    '500': 'Internal Server Error',
    '501': 'Not Implemented',
    '502': 'Bad Gateway',
    '503': 'Service Unavailable',
    '504': 'Gateway Timeout',
    '505': 'HTTP Version Not Supported'
};
function getJSON(url, cb) {
    let xhr = new XMLHttpRequest();
    console.log({ get: url });
    xhr.open('GET', baseUrl.length > 0 ? `${baseUrl}${url}` : url, true);
    xhr.setRequestHeader('apikey', security.apiKey);
    xhr.responseType = 'json';
    xhr.onload = () => {
        let status = xhr.status;
        if (status !== 200) {
            let err = xhr.response || {};
            err.htmlError = status;
            err.service = `GET ${url}`;
            if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
            cb(xhr.response, null);
        }
        else {
            cb(null, xhr.response);
        }
    };
    xhr.onerror = (evt) => {
        let err = {
            htmlError: xhr.status || 500,
            service: `GET ${url}`
        };
        if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
        cb(err, null);
    };
    xhr.send();
}
function getJSONSync(url, cb) {
    let overlay = ui.waitMessage(get('divContainer'));
    let xhr = new XMLHttpRequest();
    xhr.responseType = 'json';
    xhr.onload = () => {
        let status = xhr.status;
        if (status !== 200) {
            let err = xhr.response || {};
            err.htmlError = status;
            err.service = `GET ${url}`;
            if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
            cb(xhr.response, null);
        }
        else {
            console.log({ get: url, obj:xhr.response });
            cb(null, xhr.response);
        }
        if (typeof overlay !== 'undefined') overlay.remove();
    };

        xhr.onerror = (evt) => {
            let err = {
                htmlError: xhr.status || 500,
                service: `GET ${url}`
            };
            if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
            cb(err, null);
            if (typeof overlay !== 'undefined') overlay.remove();
        };
            xhr.onabort = (evt) => {
                console.log('Aborted');
                if (typeof overlay !== 'undefined') overlay.remove();
            };
                xhr.open('GET', baseUrl.length > 0 ? `${baseUrl}${url}` : url, true);
                xhr.setRequestHeader('apikey', security.apiKey);
                xhr.send();
}
function getText(url, cb) {
    let xhr = new XMLHttpRequest();
    console.log({ get: url });
    xhr.open('GET', baseUrl.length > 0 ? `${baseUrl}${url}` : url, true);
    xhr.setRequestHeader('apikey', security.apiKey);
    xhr.responseType = 'text';
    xhr.onload = () => {
        let status = xhr.status;
        if (status !== 200) {
            let err = xhr.response || {};
            err.htmlError = status;
            err.service = `GET ${url}`;
            if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
            cb(err, null);
        }
        else
            cb(null, xhr.response);
    };
    xhr.onerror = (evt) => {
        let err = {
            htmlError: xhr.status || 500,
            service: `GET ${url}`
        };
        if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
        cb(err, null);
    };
    xhr.send();
}
function postJSONSync(url, data, cb) {
    let overlay = ui.waitMessage(get('divContainer'));
    try {
        let xhr = new XMLHttpRequest();
        console.log({ post: url, data: data });
        let fd = new FormData();
        for (let name in data) {
            fd.append(name, data[name]);
        }
        xhr.open('POST', baseUrl.length > 0 ? `${baseUrl}${url}` : url, true);
        xhr.responseType = 'json';
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('apikey', security.apiKey);
        xhr.onload = () => {
            let status = xhr.status;
            console.log(xhr);
            if (status !== 200) {
                let err = xhr.response || {};
                err.htmlError = status;
                err.service = `POST ${url}`;
                err.data = data;
                if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
                cb(err, null);
            }
            else {
                cb(null, xhr.response);
            }
            overlay.remove();
        };
        xhr.onerror = (evt) => {
            console.log(xhr);
            let err = {
                htmlError: xhr.status || 500,
                service: `POST ${url}`
            };
            if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
            cb(err, null);
            overlay.remove();
        };
        xhr.send(fd);
    } catch (err) { ui.serviceError(get('divContainer'), err); }
}
function putJSON(url, data, cb) {
    let xhr = new XMLHttpRequest();
    console.log({ put: url, data: data });
    xhr.open('PUT', baseUrl.length > 0 ? `${baseUrl}${url}` : url, true);
    xhr.responseType = 'json';
    xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('apikey', security.apiKey);
    xhr.onload = () => {
        let status = xhr.status;
        if (status !== 200) {
            let err = xhr.response || {};
            err.htmlError = status;
            err.service = `PUT ${url}`;
            err.data = data;
            if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
            cb(err, null);
        }
        else {
            cb(null, xhr.response);
        }
    };
    xhr.onerror = (evt) => {
        console.log(xhr);
        let err = {
            htmlError: xhr.status || 500,
            service: `PUT ${url}`
        };
        if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
        cb(err, null);
    };
    xhr.send(JSON.stringify(data));
}
function putJSONSync(url, data, cb) {
    let overlay = ui.waitMessage(get('divContainer'));
    try {
        let xhr = new XMLHttpRequest();
        console.log({ put: url, data: data });
        //xhr.open('PUT', url, true);
        xhr.open('PUT', baseUrl.length > 0 ? `${baseUrl}${url}` : url, true);
        xhr.responseType = 'json';
        xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('apikey', security.apiKey);
        xhr.onload = () => {
            let status = xhr.status;
            if (status !== 200) {
                let err = xhr.response || {};
                err.htmlError = status;
                err.service = `PUT ${url}`;
                err.data = data;
                if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
                cb(err, null);
            }
            else {
                cb(null, xhr.response);
            }
            overlay.remove();
        };
        xhr.onerror = (evt) => {
            console.log(xhr);
            let err = {
                htmlError: xhr.status || 500,
                service: `PUT ${url}`
            };
            if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
            cb(err, null);
            overlay.remove();
        };
        xhr.send(JSON.stringify(data));
    } catch (err) { ui.serviceError(get('divContainer'), err); }
}
var socket;
var tConnect = null;
var sockIsOpen = false;
var connecting = false;
var connects = 0;
var connectFailed = 0;
async function initSockets() {
    if (connecting) return;
    console.log('Connecting to socket...');
    connecting = true;
    if (tConnect) clearTimeout(tConnect);
    tConnect = null;
    let wms = document.getElementsByClassName('socket-wait');
    for (let i = 0; i < wms.length; i++) {
        wms[i].remove();
    }
    const sockMsg = (typeof general !== 'undefined' && general.rebooting)
        ? (tr('MSG_REBOOTING') || REBOOT_WAIT_FALLBACK)
        : (tr('MSG_RECONNECTING') || 'Reconnecting… please wait');
    ui.waitMessage(get('divContainer') || document.body, sockMsg).classList.add('socket-wait');
    let host = window.location.protocol === 'file:' ? hst : window.location.hostname;
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const port = window.location.protocol === 'https:' ? '' : ':8080';
        socket = new WebSocket(`${protocol}//${host}${port}/`);
        socket.onmessage = (evt) => {
            if (evt.data.startsWith('42')) {
                let ndx = evt.data.indexOf(',');
                let eventName = evt.data.substring(3, ndx);
                let data = evt.data.substring(ndx + 1, evt.data.length - 1);
                try {
                    var reISO = /^(\d{4}|\+010000)-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*))(?:Z|(\+|-)([\d|:]*))?$/;
                    var reMsAjax = /^\/Date\((d|-|.*)\)[\/|\\]$/;
                    var msg = JSON.parse(data, (key, value) => {
                        if (typeof value === 'string') {
                            var a = reISO.exec(value);
                            if (a) return new Date(value);
                            a = reMsAjax.exec(value);
                            if (a) {
                                var b = a[1].split(/[-+,.]/);
                                return new Date(b[0] ? +b[0] : 0 - +b[1]);
                            }
                        }
                        return value;
                    });
                    if (typeof wifi !== 'undefined' && wifi.noteNetworkActivity) wifi.noteNetworkActivity(eventName);
                    switch (eventName) {
                        case 'memStatus':
                            firmware.procMemoryStatus(msg);
                            break;
                        case 'updateProgress':
                            firmware.procUpdateProgress(msg);
                            break;
                        case 'fwStatus':
                            firmware.procFwStatus(msg);
                            break;
                        case 'remoteFrame':
                            somfy.procRemoteFrame(msg);
                            break;
                        case 'txFrame':
                            somfy.procTxFrame(msg);
                            break;
                        case 'groupState':
                            somfy.procGroupState(msg);
                            break;
                        case 'shadeState':
                            somfy.procShadeState(msg);
                            break;
                        case 'shadeCommand':
                            console.log(msg);
                            break;
                        case 'roomRemoved':
                            somfy.procRoomRemoved(msg);
                            break;
                        case 'roomAdded':
                            somfy.procRoomAdded(msg);
                            break;
                        case 'shadeRemoved':
                            break;
                        case 'shadeAdded':
                            break;
                        case 'ethernet':
                            wifi.procEthernet(msg);
                            break;
                        case 'wifiStrength':
                            wifi.procWifiStrength(msg);
                            break;
                        case 'packetPulses':
                            console.log(msg);
                            break;
                        case 'frequencyScan':
                            somfy.procFrequencyScan(msg);
                            break;
                        case 'fixedCodeState':
                            somfy.procFixedCodeState(msg);
                            break;
                        case 'fixedCodeLearn':
                            somfy.procFixedCodeLearn(msg);
                            break;
                        case 'fixedCodeRemoved':
                            somfy.procFixedCodeRemoved(msg);
                            break;
                    }
                } catch (err) {
                    console.log({ eventName: eventName, data: data, err: err });
                }
            }
        };
        socket.onopen = (evt) => {
            if (tConnect) clearTimeout(tConnect);
            tConnect = null;
            console.log({ msg: 'open', evt: evt });
            sockIsOpen = true;
            connecting = false;
            connects++;
            connectFailed = 0;
            let wms = document.getElementsByClassName('socket-wait');
            for (let i = 0; i < wms.length; i++) {
                wms[i].remove();
            }
            let errs = document.getElementsByClassName('socket-error');
            for (let i = 0; i < errs.length; i++)
                errs[i].remove();
            if (general.reloadApp) {
                general.rebooting = false;
                general.reload();
            }
            else {
                (async () => {
                    ui.clearErrors();
                    await general.loadGeneral();
                    await wifi.loadNetwork();
                    await somfy.loadSomfy();
                    await mqtt.loadMQTT();
                    if (ui.isConfigOpen()) socket.send('join:0');
                })();
            }
        };
        socket.onclose = (evt) => {
            wifi.procWifiStrength({ ssid: '', channel: -1, strength: -100 });
            wifi.procEthernet({ connected: false, speed: 0, fullduplex: false });
            if (document.getElementsByClassName('socket-wait').length === 0) {
                const msg = general.rebooting
                    ? (tr('MSG_REBOOTING') || REBOOT_WAIT_FALLBACK)
                    : (tr('MSG_RECONNECTING') || 'Reconnecting… please wait');
                ui.waitMessage(get('divContainer') || document.body, msg).classList.add('socket-wait');
            }
            if (evt.wasClean) {
                console.log({ msg: 'close-clean', evt: evt });
                connectFailed = 0;
                tConnect = setTimeout(async () => { await reopenSocket(); }, 7000);
                console.log('Reconnecting socket in 7 seconds');
            }
            else {
                console.log({ msg: 'close-died', reason: evt.reason, evt: evt, sock: socket });
                if (connects > 0) {
                    console.log('Reconnecting socket in 3 seconds');
                    tConnect = setTimeout(async () => { await reopenSocket(); }, 3000);
                }
                else {
                    if (connecting) {
                        connectFailed++;
                        let timeout = Math.min(connectFailed * 500, 10000);
                        console.log(`Initial socket did not connect try again (server was busy and timed out ${connectFailed} times)`);
                        tConnect = setTimeout(async () => { await reopenSocket(); }, timeout);
                        if (connectFailed === 5) {
                            ui.socketError('Too many clients connected.  A maximum of 5 clients may be connected at any one time.  Close some connections to the ESP Somfy RTS device to proceed.');
                        }
                        let spanAttempts = get('spanSocketAttempts');
                        if (spanAttempts) spanAttempts.innerHTML = connectFailed.fmt("#,##0");
                    }
                    else {
                        console.log('Connecting socket in .5 seconds');
                        tConnect = setTimeout(async () => { await reopenSocket(); }, 500);
                    }
                }
            }
            connecting = false;
        };
        socket.onerror = (evt) => {
            console.log({ msg: 'socket error', evt: evt, sock: socket });
        };
    } catch (err) {
        console.log({
            msg: 'Websocket connection error', err: err
        });
        tConnect = setTimeout(async () => { await reopenSocket(); }, 5000);
    }
}
function clearOverlays() {
    if (typeof firmware !== 'undefined' && firmware.isUpdateBusy && firmware.isUpdateBusy()) return;
    const selectors = ['.inst-overlay', '.info-message', '.prompt-message', '.error-message', '.instructions', '#divGitInstall'];
    selectors.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
}
/**
 * synchronisation Sidebar et Tabs
 * @param {string} groupId - L'ID du groupe à activer
 * @param {boolean} isSubTab - Si c'est un sous-onglet
 */
function syncNavigationState(groupId, isSubTab = false) {
    if (!groupId) return;
    if (!isSubTab) {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.getAttribute('data-grpid') === groupId));
        document.querySelectorAll('.submenu').forEach(s => {
            const isTarget = s.previousElementSibling?.getAttribute('data-grpid') === groupId;
            s.style.display = isTarget ? 'flex' : 'none';

            if (isTarget) {
                const firstSub = s.querySelector('.sub-nav-item');
                if (firstSub) {
                    s.querySelectorAll('.sub-nav-item').forEach(sub => sub.classList.remove('active'));
                    firstSub.classList.add('active');
                }
            }
        });
        document.querySelectorAll('.tab-container > span').forEach(t => t.classList.toggle('selected', t.getAttribute('data-grpid') === groupId));
        const targetPanel = get(groupId);
        if (targetPanel) {
            const firstSubTab = targetPanel.querySelector('.subtab-container > span');
            if (firstSubTab) {
                firstSubTab.click();
            }
        }
    } else {
        document.querySelectorAll('.sub-nav-item').forEach(i => i.classList.toggle('active', i.getAttribute('data-grpid') === groupId));
        document.querySelectorAll('.subtab-container > span').forEach(t => t.classList.toggle('selected', t.getAttribute('data-grpid') === groupId));
    }
}
function bindNavigation() {
    document.querySelectorAll('.nav-item, .sub-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (typeof firmware !== 'undefined' && firmware.isUpdateBusy && firmware.isUpdateBusy()) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            e.preventDefault();
            clearOverlays();
            const groupId = item.getAttribute('data-grpid');
            const isSub = item.classList.contains('sub-nav-item');

            if (groupId === 'divHomePnl') {
                if (typeof ui !== 'undefined') ui.goHome();
                return;
            }
            if (typeof ui !== 'undefined') {
                ui.openSettingsSection(isSub ? item.closest('.nav-group')?.querySelector('.nav-item')?.getAttribute('data-grpid') || groupId : groupId);
            }
            if (isSub) {
                const originalTab = document.querySelector(`.subtab-container > span[data-grpid="${groupId}"]`);
                if (originalTab) originalTab.click();
                return;
            }
            const selector = `.tab-container > span[data-grpid="${groupId}"]`;
            const originalTab = document.querySelector(selector);

            if (originalTab) {
                originalTab.click();
            } else {
                syncNavigationState(groupId);
                const firstSub = item.nextElementSibling?.querySelector('.sub-nav-item');
                if (firstSub) firstSub.click();
            }
        });
    });
    document.querySelectorAll('.tab-container > span, .subtab-container > span').forEach(tab => {
        tab.addEventListener('click', (evt) => {
            if (typeof firmware !== 'undefined' && firmware.isUpdateBusy && firmware.isUpdateBusy()) {
                evt.preventDefault();
                evt.stopPropagation();
                return;
            }
            const groupId = tab.getAttribute('data-grpid');
            const isSub = tab.parentElement.classList.contains('subtab-container');
            syncNavigationState(groupId, isSub);
            if (!isSub) {
                if (typeof ui !== 'undefined') ui.setShellMode('settings', groupId);
                const hub = get('divSettingsHub');
                if (hub) hub.style.display = 'none';
                if (groupId !== 'divSomfySettings' && typeof somfy !== 'undefined') {
                    somfy.showEditShade(false); somfy.showEditGroup(false);
                }
                if (groupId === 'divNetworkSettings' && typeof wifi !== 'undefined') wifi.loadNetwork();
                document.querySelectorAll('.tab-container > span').forEach(t => {
                    const panel = get(t.getAttribute('data-grpid'));
                    if (panel) panel.style.display = (t.getAttribute('data-grpid') === groupId) ? '' : 'none';
                });
            } else {
                if (typeof ui !== 'undefined') ui.selectTab(tab);
            }
        });
    });
}
function stepDeviceGpio(pinKey, direction, prefix, boardSelectId, isManualCallback, pinMaps) {
    const selBoard = get(boardSelectId);
    if (!selBoard) return;

    const isM = isManualCallback(parseInt(selBoard.value, 10));
    const el = get((isM ? 'input' : 'sel') + prefix + pinKey);
    if (!el) return;

    let newValue;

    if (isM) {
        let current = parseInt(el.value, 10);
        if (isNaN(current)) current = 0;

        let next = current + direction;
        const cm = (get('divContainer').getAttribute('data-chipmodel') || "").toLowerCase();
        const pm = pinMaps.find(x => x.name === cm) || { maxPins: 39 };

        if (next < 0 || next > pm.maxPins) return;

        el.value = next;
        newValue = next;

        const selPin = get(`sel${prefix}${pinKey}`);
        if (selPin) selPin.value = next;
    } else {
        const nextIndex = el.selectedIndex + direction;
        if (nextIndex < 0 || nextIndex >= el.options.length) return;

        el.selectedIndex = nextIndex;
        newValue = el.value;

        const inpP = get(`input${prefix}${pinKey}`);
        if (inpP) inpP.value = newValue;
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return newValue;
}
function overlayHeader(title, desc, icon = 'svg-simpleShutter', showExpert = false) {
    const expertSwitch = showExpert ? `<div class="expert-mode-container"><span class="expert-label">${tr("BT_EXPERT_MODE")}</span><span class="switch expert-switch"><input id="cbExpertMode" type="checkbox" ${ui.isExpertMode ? 'checked' : ''} onchange="ui.toggleExpertMode(this.closest('.inst-overlay'));" onclick="event.stopPropagation();"><div></div></span></div>` : '';

    return `<div class="overlay-header">${expertSwitch}<div close onclick="closeOverlay(this.closest('.inst-overlay'))"><svg class="closeShow-desktop"><use href=#svg-close></use></svg></div></div><div class="instructions-header"><div><h2>${tr(title)}</h2><p>${tr(desc)}</p></div><svg class="instructions-headerLogo"><use href=#${icon}></use></svg></div>`;
}
function wizardStepper(stepsData, translationPrefix) {
    let stepsHtml = '';
    let titlesHtml = '';

    const isArray = Array.isArray(stepsData);
    const totalSteps = isArray ? stepsData.length : stepsData;

    for (let i = 1; i <= totalSteps; i++) {
        stepsHtml += `<div class="stepper-item" data-stepid="${i}"><div class="step-counter">${i}</div></div>`;

        let titleKey;
        if (isArray) {
            titleKey = stepsData[i - 1];
        } else {
            titleKey = `${translationPrefix}_STEP${i}`;
        }
        titlesHtml += `<h3 class="step-title wizard-step" data-stepid="${i}">${tr(titleKey)}</h3>`;
    }
    return `
    <div class="stepper-wrapper" style="--steps: ${totalSteps};">
    ${stepsHtml}
    </div>
    <div class="step-title-container">
    ${titlesHtml}
    </div>`;
}
function shOverlay(div, onClose) {
    if (!div) return;
    const btn = div.querySelector('[close]');
    if (btn) btn.onclick = () => closeOverlay(div, onClose);
    get('divContainer').appendChild(div);
    window.scrollTo(0, 0);
}
function toggleTooltip(el) {
    const tooltip = el.querySelector('.tooltip-text');
    const isVisible = tooltip.style.display === 'block';

    document.querySelectorAll('.tooltip-text').forEach(t => t.style.display = 'none');
    tooltip.style.display = isVisible ? 'none' : 'block';

    if (!isVisible) {
        setTimeout(() => {
            window.addEventListener('click', function closeMenu() {
                tooltip.style.display = 'none';
                window.removeEventListener('click', closeMenu);
            }, { once: true });
        }, 10);
    }
}

async function reopenSocket() {
    if (tConnect) clearTimeout(tConnect);
    tConnect = null;
    await initSockets();
}
async function init() {
    await security.init();
    general.init();
    wifi.init();
    somfy.init();
    mqtt.init();
    firmware.init();
    if (typeof mesh !== 'undefined') mesh.init();
    somfy.setStep('freq', 1);
    somfy.setStep('bandwidth', 1);
    somfy.setStep('deviation', 1);

    bindNavigation();
    document.addEventListener('click', (e) => {
        const el = e.target.closest && e.target.closest('.copyable');
        if (!el || typeof ui === 'undefined') return;
        e.preventDefault();
        e.stopPropagation();
        ui.copyText(el);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const fld = get('fldHomeSearch');
        if (fld && fld.value && document.documentElement.getAttribute('data-shell') !== 'settings') {
            fld.value = '';
            if (typeof somfy !== 'undefined') {
                somfy.filterHome('');
                somfy.toggleHomeSearch(false);
            }
            e.preventDefault();
        }
    });
    if (typeof ui !== 'undefined' && !ui.isConfigOpen()) {
        const hBtn = document.querySelector('.nav-item[data-grpid="divHomePnl"]');
        if (hBtn) {
            syncNavigationState('divHomePnl');
            if (typeof ui !== 'undefined') ui.setShellMode('home');
        }
    }
}
class UIBinder {
    setValue(el, val) {
        if (el instanceof HTMLInputElement) {
            switch (el.type.toLowerCase()) {
                case 'checkbox':
                    el.checked = makeBool(val);
                    break;
                case 'range':
                    let dt = el.getAttribute('data-datatype');
                    let mult = parseInt(el.getAttribute('data-mult') || 1, 10);
                    switch (dt) {
                        // We always range with integers
                        case 'float':
                            el.value = Math.round(parseInt(val * mult, 10));
                            break;
                        case 'index':
                            let ivals = JSON.parse(el.getAttribute('data-values'));
                            for (let i = 0; i < ivals.length; i++) {
                                if (ivals[i].toString() === val.toString()) {
                                    el.value = i;
                                    break;
                                }
                            }
                            break;
                        default:
                            el.value = parseInt(val, 10) * mult;
                            break;
                    }
                    break;
                        default:
                            el.value = val;
                            break;
            }
        }
        else if (el instanceof HTMLSelectElement) {
            let ndx = 0;
            for (let i = 0; i < el.options.length; i++) {
                let opt = el.options[i];
                if (opt.value === val.toString()) {
                    ndx = i;
                    break;
                }
            }
            el.selectedIndex = ndx;
        }
        else if (el instanceof HTMLElement) el.innerHTML = val;
    }
    getValue(el, defVal) {
        let val = defVal;
        if (el instanceof HTMLInputElement) {
            switch (el.type.toLowerCase()) {
                case 'checkbox':
                    val = el.checked;
                    break;
                case 'range':
                    let dt = el.getAttribute('data-datatype');
                    let mult = parseInt(el.getAttribute('data-mult') || 1, 10);
                    switch (dt) {
                        // We always range with integers
                        case 'float':
                            val = parseInt(el.value, 10) / mult;
                            break;
                        case 'index':
                            let ivals = JSON.parse(el.getAttribute('data-values'));
                            val = ivals[parseInt(el.value, 10)];
                            break;
                        default:
                            val = parseInt(el.value / mult, 10);
                            break;
                    }
                    break;
                        default:
                            val = el.value;
                            break;
            }
        }
        else if (el instanceof HTMLSelectElement) val = el.value;
        else if (el instanceof HTMLElement) val = el.innerHTML;
        return val;
    }
    toElement(el, val) {
        let flds = el.querySelectorAll('*[data-bind]');
        flds.forEach((fld) => {
            let prop = fld.getAttribute('data-bind');
            let arr = prop.split('.');
            let tval = val;
            for (let i = 0; i < arr.length; i++) {
                var s = arr[i];
                if (typeof s === 'undefined' || !s) continue;
                let ndx = s.indexOf('[');
                if (ndx !== -1) {
                    ndx = parseInt(s.substring(ndx + 1, s.indexOf(']') - 1), 10);
                    s = s.substring(0, ndx - 1);
                }
                tval = tval[s];
                if (typeof tval === 'undefined') break;
                if (ndx >= 0) tval = tval[ndx];
            }
            if (typeof tval !== 'undefined') {
                if (typeof fld.val === 'function') this.val(tval);
                else {
                    switch (fld.getAttribute('data-fmttype')) {
                        case 'time':
                        {
                            var dt = new Date();
                            dt.setHours(0, 0, 0);
                            dt.addMinutes(tval);
                            tval = dt.fmt(fld.getAttribute('data-fmtmask'), fld.getAttribute('data-fmtempty') || '');
                        }
                        break;
                        case 'date':
                        case 'datetime':
                        {
                            let dt = new Date(tval);
                            tval = dt.fmt(fld.getAttribute('data-fmtmask'), fld.getAttribute('data-fmtempty') || '');
                        }
                        break;
                        case 'number':
                            if (typeof tval !== 'number') tval = parseFloat(tval);
                            tval = tval.fmt(fld.getAttribute('data-fmtmask'), fld.getAttribute('data-fmtempty') || '');
                        break;
                        case 'duration':
                            tval = ui.formatDuration(tval, $this.attr('data-fmtmask'));
                            break;
                    }
                    this.setValue(fld, tval);
                }
            }
        });
    }
    fromElement(el, obj, arrayRef) {
        if (typeof arrayRef === 'undefined' || arrayRef === null) arrayRef = [];
        if (typeof obj === 'undefined' || obj === null) obj = {};
        if (typeof el.getAttribute('data-bind') !== 'undefined') this._bindValue(obj, el, this.getValue(el), arrayRef);
        let flds = el.querySelectorAll('*[data-bind]');
        flds.forEach((fld) => {
            if (!makeBool(fld.getAttribute('data-setonly')))
                this._bindValue(obj, fld, this.getValue(fld), arrayRef);
        });
        return obj;
    }
    parseNumber(val) {
        if (val === null) return;
        if (typeof val === 'undefined') return val;
        if (typeof val === 'number') return val;
        if (typeof val.getMonth === 'function') return val.getTime();
        var tval = val.replace(/[^0-9\.\-]+/g, '');
        return tval.indexOf('.') !== -1 ? parseFloat(tval) : parseInt(tval, 10);
    }
    _bindValue(obj, el, val, arrayRef) {
        var binding = el.getAttribute('data-bind');
        var dataType = el.getAttribute('data-datatype');
        if (binding && binding.length > 0) {
            var sRef = '';
            var arr = binding.split('.');
            var t = obj;
            for (var i = 0; i < arr.length - 1; i++) {
                let s = arr[i];
                if (typeof s === 'undefined' || s.length === 0) continue;
                sRef += '.' + s;
                var ndx = s.lastIndexOf('[');
                if (ndx !== -1) {
                    var v = s.substring(0, ndx);
                    var ndxEnd = s.lastIndexOf(']');
                    var ord = parseInt(s.substring(ndx + 1, ndxEnd), 10);
                    if (isNaN(ord)) ord = 0;
                    if (typeof arrayRef[sRef] === 'undefined') {
                        if (typeof t[v] === 'undefined') {
                            t[v] = new Array();
                            t[v].push(new Object());
                            t = t[v][0];
                            arrayRef[sRef] = ord;
                        }
                        else {
                            k = arrayRef[sRef];
                            if (typeof k === 'undefined') {
                                a = t[v];
                                k = a.length;
                                arrayRef[sRef] = k;
                                a.push(new Object());
                                t = a[k];
                            }
                            else
                                t = t[v][k];
                        }
                    }
                    else {
                        k = arrayRef[sRef];
                        if (typeof k === 'undefined') {
                            a = t[v];
                            k = a.length;
                            arrayRef[sRef] = k;
                            a.push(new Object());
                            t = a[k];
                        }
                        else
                            t = t[v][k];
                    }
                }
                else if (typeof t[s] === 'undefined') {
                    t[s] = new Object();
                    t = t[s];
                }
                else
                    t = t[s];
            }
            if (typeof dataType === 'undefined') dataType = 'string';
            t[arr[arr.length - 1]] = this.parseValue(val, dataType);
        }
    }
    parseValue(val, dataType) {
        switch (dataType) {
            case 'int':
                return Math.floor(this.parseNumber(val));
            case 'uint':
                return Math.abs(this.parseNumber(val));
            case 'float':
            case 'real':
            case 'double':
            case 'decimal':
            case 'number':
                return this.parseNumber(val);
            case 'date':
                if (typeof val === 'string') return Date.parseISO(val);
                else if (typeof val === 'number') return new Date(number);
                else if (typeof val.getMonth === 'function') return val;
                return undefined;
            case 'time':
                var dt = new Date();
                if (typeof val === 'number') {
                    dt.setHours(0, 0, 0);
                    dt.addMinutes(tval);
                    return dt;
                }
                else if (typeof val === 'string' && val.indexOf(':') !== -1) {
                    var n = val.lastIndexOf(':');
                    var min = this.parseNumber(val.substring(n));
                    var nsp = val.substring(0, n).lastIndexOf(' ') + 1;
                    var hrs = this.parseNumber(val.substring(nsp, n));
                    dt.setHours(0, 0, 0);
                    if (hrs <= 12 && val.substring(n).indexOf('p')) hrs += 12;
                    dt.addMinutes(hrs * 60 + min);
                    return dt;
                }
                break;
            case 'duration':
                if (typeof val === 'number') return val;
                return Math.floor(this.parseNumber(val));
            default:
                return val;
        }
    }
    formatValue(val, dataType, fmtMask, emptyMask) {
        var v = this.parseValue(val, dataType);
        if (typeof v === 'undefined') return emptyMask || '';
        switch (dataType) {
            case 'int':
            case 'uint':
            case 'float':
            case 'real':
            case 'double':
            case 'decimal':
            case 'number':
                return v.fmt(fmtMask, emptyMask || '');
            case 'time':
            case 'date':
            case 'dateTime':
                return v.fmt(fmtMask, emptyMask || '');
        }
        return v;
    }
    waitMessage(el, text) {
        let div = document.createElement('div');
        const label = text
            ? `<div class="reboot-wait-text">${text}</div>`
            : '';
        div.innerHTML = `<div class="reboot-wait-box"><div class="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>${label}</div>`;
        div.classList.add('wait-overlay');
        if (typeof el === 'undefined' || !el) el = get('divContainer') || document.body;
        el.appendChild(div);
        return div;
    }
    serviceError(el, err) {
        let title = 'Service Error'
        if (arguments.length === 1) {
            err = el;
            el = get('divContainer');
        }
        let msg = '';
        if (typeof err === 'string' && err.startsWith('{')) {
            let e = JSON.parse(err);
            if (typeof e !== 'undefined' && typeof e.desc === 'string') msg = e.desc;
            else msg = err;
        }
        else if (typeof err === 'string') msg = err;
        else if (typeof err === 'number') {
            switch (err) {
                case 404:
                    msg = `404: Service not found`;
                    break;
                default:
                    msg = `${err}: Service Error`;
                    break;
            }
        }
        else if (typeof err !== 'undefined') {
            if (typeof err.desc === 'string') {
                msg = typeof err.desc !== 'undefined' ? err.desc : err.message;
                if (typeof err.code === 'number') {
                    let e = errors.find(x => x.code === err.code) || { code: err.code, desc: 'Unspecified error' };
                    msg = e.desc;
                    title = err.desc;
                }
            }
        }
        console.log(err);
        let div = this.errorMessage(`${err.htmlError || 500}:${title}`);
        let sub = div.querySelector('.sub-message');
        sub.innerHTML = `<div><label>Service:</label>${err.service}</div><div style="font-size:22px;">${msg}</div>`;
        return div;
    }
    socketError(el, msg) {
        if (arguments.length === 1) {
            msg = el;
            el = get('divContainer');
        }
        let existing = document.querySelector('.socket-error');
        if (existing) {
            return existing;
        }
        let div = document.createElement('div');
        div.innerHTML = `<div id="divSocketAttempts" class="socketAttempts"><span>Attempts:</span><span id="spanSocketAttempts"></span></div><div class="inner-error"><div>Unable to connect to the server</div><hr><div style="font-size:.7em">${msg}</div></div>`;
        div.classList.add('error-message');
        div.classList.add('socket-error');
        div.classList.add('modal-overlay');
        el.appendChild(div);
        return div;
    }
    errorMessage(el, msg) {
        this.clearErrors();
        if (arguments.length === 1) {
            msg = el;
            el = get('divContainer');
        }
        let div = document.createElement('div');
        div.innerHTML = `<div class="error-content"><div class="inner-error">${msg}</div><div class="sub-message"></div><button type="button" onclick="ui.clearErrors();">Close</button></div>`;
        div.classList.add('error-message', 'modal-overlay');
        el.appendChild(div);
        return div;
    }
    promptMessage(el, msg, onYes) {
        if (arguments.length === 2) {
            onYes = msg;
            msg = el;
            el = get('divContainer');
        }
        let div = document.createElement('div');
        div.className = 'prompt-message modal-overlay';
        div.innerHTML = `<div class="message-content"><div class="prompt-text">${msg}</div><div class="sub-message"></div>
        <div class="button-container-row"><button line type="button" onclick="ui.clearErrors();">${tr('BT_NO')}</button><button id="btnYes" type="button">${tr('BT_YES')}</button></div></div>`;
        el.appendChild(div);

        div.querySelector('#btnYes').onclick = () => {
            if (typeof onYes === 'function') onYes();
            ui.clearErrors();
        };
        return div;
    }
    infoMessage(el, msg, onOk) {
        if (arguments.length === 1) {
            onOk = msg;
            msg = el;
            el = get('divContainer');
        }
        let div = document.createElement('div');
        div.innerHTML = `<div class="message-content"><div class="info-text">${msg}</div><div class="sub-message"></div><div class="button-container-row"><button id="btnOk" type="button">${tr('BT_OK')}</button></div></div>`;
        div.classList.add('info-message', 'modal-overlay');
        el.appendChild(div);

        const btnOk = div.querySelector('#btnOk');
        if (typeof onOk === 'function') {
            btnOk.addEventListener('click', onOk);
        } else {
            btnOk.addEventListener('click', () => closeOverlay(div));
        }
        return div;
    }
    clearErrors() {
        let errors = document.querySelectorAll('div.modal-overlay');
        errors.forEach((el) => {
            el.classList.add('overlay-exit');
        });
        if (errors.length > 0) {
            setTimeout(() => {
                errors.forEach(el => el.remove());
            }, 300);
        }
    }
    successMessage(msg) {
        this.clearErrors();
        let el = get('divContainer');

        let div = document.createElement('div');
        div.innerHTML = `<div class="success-content"><svg class="icon-svg"><use href="#svg-succes"></use></svg><span>${msg}</span></div>`;

        div.classList.add('success-toast');
        el.appendChild(div);

        setTimeout(() => {
            div.classList.add('hide');
            setTimeout(() => {
                if (div.parentNode) div.remove();
            }, 400);

        }, 3500);
        return div;
    }
    copyText(el) {
        const t = (typeof el === 'string' ? el : ((el && el.textContent) || '')).replace(/\s+/g, ' ').trim();
        if (!t || /^-+$/.test(t) || t === '--' || t.indexOf('--:') === 0) return;
        const done = () => {
            document.querySelectorAll('.copy-toast').forEach(n => n.remove());
            const div = document.createElement('div');
            div.className = 'success-toast copy-toast';
            div.innerHTML = `<div class="success-content"><span>${tr('COPIED') || 'Copied'}</span></div>`;
            (get('divContainer') || document.body).appendChild(div);
            setTimeout(() => { div.classList.add('hide'); setTimeout(() => div.remove(), 300); }, 1100);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(done).catch(() => {});
        } else done();
    }
    copyNetworkIp() {
        const ip = (typeof wifi !== 'undefined' && wifi.netInfo && wifi.netInfo.ip) || window.location.hostname || '';
        this.copyText(ip);
    }
    errorToast(msg) {
        let el = get('divContainer');
        document.querySelectorAll('.error-toast').forEach((n) => n.remove());
        let div = document.createElement('div');
        div.innerHTML = `<div class="success-content"><span>${msg}</span></div>`;
        div.classList.add('error-toast');
        el.appendChild(div);
        setTimeout(() => {
            div.classList.add('hide');
            setTimeout(() => {
                if (div.parentNode) div.remove();
            }, 400);
        }, 3500);
        return div;
    }
    toggleExpertMode(el) {
        this.isExpertMode = !this.isExpertMode;
        localStorage.setItem('expertMode', this.isExpertMode);

        if (el) {
            el.classList.toggle('is-expert', this.isExpertMode);
            if (!this.isExpertMode) {
                this.wizSetStep(el, this.wizCurrentStep(el));
            }
        }
    }
    /**Dirige l'attention de l'utilisateur sur un élément spécifique
     * @param {string|HTMLElement} target - ID de l'élément ou l'élément lui-même
     * @param {boolean} activate - Activer ou désactiver l'animation
     * @param {string} color - Couleur spécifique (ex: 'red', '#FFA500')
     */
    setFocus(target, activate = true, color = null) {
        let el = (typeof target === 'string') ? document.getElementById(target) : target;
        if (!el) return;
        if (el.tagName === 'BUTTON' && el.classList.contains('unibutton')) {
            el = el.closest('.unibloc') || el;
        }
        if (activate) {
            if (color) el.style.setProperty('--pulse-color', color);
            el.classList.add('ui-pulse');
        } else {
            el.classList.remove('ui-pulse');
            el.style.removeProperty('--pulse-color');
        }
    }
    selectTab(elTab) {
        const groupId = elTab.getAttribute('data-grpid');
        if (!groupId) return;

        const siblings = elTab.parentElement.querySelectorAll('span, a');
        for (let sibling of siblings) {
            sibling.classList.remove('selected', 'active');

            let sid = sibling.getAttribute('data-grpid');
            if (sid && sid !== groupId) {
                let section = get(sid);
                if (section) section.style.display = 'none';
            }
        }
        elTab.classList.add(elTab.classList.contains('sub-nav-item') ? 'active' : 'selected');

        const targetSection = get(groupId);
        if (targetSection) targetSection.style.display = '';
        if (groupId === 'divAlexa' && typeof alexa !== 'undefined') alexa.loadPage();
        if (['divSomfySettings', 'divMeshSettings', 'divRadioSettings', 'divNetworkSettings', 'divSystemSettings'].includes(groupId)) {
            this.setSettingsPageTitle(groupId);
            document.documentElement.setAttribute('data-settings-section', groupId);
        }
    }
    wizSetPrevStep(el) { this.wizSetStep(el, Math.max(this.wizCurrentStep(el) - 1, 1)); }
    wizSetNextStep(el) { this.wizSetStep(el, this.wizCurrentStep(el) + 1); }
    wizSetStep(el, step) {
        let curr = this.wizCurrentStep(el);
        let sStep = step.toString();
        const isExpert = el.classList.contains('is-expert');

        el.setAttribute('data-stepid', step);
        el.querySelectorAll('[data-stepid], [data-ustepid], [data-mstepid]').forEach(item => {
            if (item.classList.contains('stepper-item')) return;
            if (item === el) return;

            let show = true;

            if (isExpert) {
                show = item.hasAttribute('data-expert');
            }
            else {
                if (item.hasAttribute('data-stepid')) {
                    show = item.getAttribute('data-stepid') === sStep;
                }
                else if (item.hasAttribute('data-ustepid')) {
                    show = item.getAttribute('data-ustepid') !== sStep;
                }
                else if (item.hasAttribute('data-mstepid')) {
                    let steps = item.getAttribute('data-mstepid').split(',');
                    show = steps.includes(sStep);
                }
            }
            item.style.display = show ? '' : 'none';
        });
        if (curr !== step) {
            let evt = new CustomEvent('stepchanged', { detail: { oldStep: curr, newStep: step }, bubbles: true });
            el.dispatchEvent(evt);
        }
    }
    wizCurrentStep(el) { return parseInt(el.getAttribute('data-stepid') || 1, 10); }
    pinKeyPressed(evt) {
        let el = evt.target || evt.srcElement;
        let parent = el.parentElement;
        let digits = Array.from(parent.querySelectorAll('.pin-digit'));
        let index = digits.indexOf(el);
        switch (evt.key) {
            case 'Backspace':
                if (el.value === '' && index > 0) digits[index - 1].focus();
                return;
            case 'ArrowLeft':
                if (index > 0) digits[index - 1].focus();
                return;
            case 'ArrowRight':
                if (index < digits.length - 1) digits[index + 1].focus();
                return;
            case 'Enter':
                if (typeof security !== 'undefined') security.login();
                return;
        }
        setTimeout(() => {
            if (el.value.length > 1) el.value = el.value.slice(-1);
            if (el.value !== "" && index < digits.length - 1) {
                digits[index + 1].focus();
            }
            const pin = digits.map(d => d.value).join('');
            if (pin.length === 4) {
                console.log("PIN complet détecté :", pin);
                if (typeof security !== 'undefined') {
                    security.login();
                } else if (typeof general !== 'undefined' && typeof general.login === 'function') {
                    general.login();
                }
            }
        }, 20);
    }
    pinDigitFocus(evt) {
        evt.srcElement.select();
    }
    isConfigOpen() { return window.getComputedStyle(get('divConfigPnl')).display !== 'none'; }
    setShellMode(mode, section) {
        const root = document.documentElement;
        root.setAttribute('data-shell', mode === 'settings' ? 'settings' : 'home');
        if (mode === 'settings') root.setAttribute('data-settings-section', section || 'hub');
        else root.removeAttribute('data-settings-section');
        document.querySelectorAll('.bottom-nav-item').forEach(btn => {
            btn.classList.toggle('is-active', btn.getAttribute('data-shell') === (mode === 'settings' ? 'settings' : 'home'));
        });
    }
    goHome() {
        this.setHomePanel();
        syncNavigationState('divHomePnl');
    }
    goSettings() {
        if (!security.authenticated && security.type !== 0) {
            get('divContainer').addEventListener('afterlogin', () => {
                if (security.authenticated) this.goSettings();
            }, { once: true });
            security.authUser();
            return;
        }
        this.setConfigPanel();
        this.showSettingsHub();
    }
    showSettingsHub() {
        this.setShellMode('settings', 'hub');
        const hub = get('divSettingsHub');
        if (hub) hub.style.display = '';
        const rail = get('spanSettingsRailTitle');
        if (rail) rail.textContent = tr('TAB_SETTINGS') || 'Settings';
        document.querySelectorAll('.tab-container > span').forEach(t => {
            const panel = get(t.getAttribute('data-grpid'));
            if (panel) panel.style.display = 'none';
        });
    }
    setSettingsPageTitle(groupId) {
        const keys = {
            divSomfySettings: 'TAB_DEVICES',
            divMeshSettings: 'TAB_MESH',
            divRadioSettings: 'TAB_RADIO',
            divNetworkSettings: 'TAB_NETWORK',
            divSystemSettings: 'TAB_SYSTEM'
        };
        const title = tr(keys[groupId] || 'TAB_SETTINGS');
        const el = get('spanSettingsPageTitle');
        if (el) el.textContent = title;
        const rail = get('spanSettingsRailTitle');
        if (rail) rail.textContent = (groupId && groupId !== 'hub') ? title : (tr('TAB_SETTINGS') || 'Settings');
    }
    openSettingsSection(groupId) {
        document.documentElement.setAttribute('data-settings-section', groupId);
        this.setConfigPanel(true);
        this.setShellMode('settings', groupId);
        this.setSettingsPageTitle(groupId);
        const hub = get('divSettingsHub');
        if (hub) hub.style.display = 'none';
        const tab = document.querySelector(`.tab-container [data-grpid="${groupId}"]`);
        if (tab) {
            this.selectTab(tab);
            if (groupId === 'divNetworkSettings' && typeof wifi !== 'undefined') wifi.loadNetwork();
        } else syncNavigationState(groupId);
    }
    setConfigPanel(keepSection) {
        let divCfg = get('divConfigPnl');
        let divHome = get('divHomePnl');
        if (divHome) divHome.style.display = 'none';
        if (divCfg) divCfg.style.display = '';
        if (typeof somfy !== 'undefined') somfy.checkEmptyState();
        const use = document.querySelector('#btnConfig use');
        if (use) use.setAttribute('href', '#svg-tabHome');
        const section = document.documentElement.getAttribute('data-settings-section') || 'hub';
        this.setShellMode('settings', section);
        if (!keepSection || section === 'hub') this.showSettingsHub();

        if (sockIsOpen) socket.send('join:0');
        const secEl = get('divSecurityOptions');
        let overlay = secEl ? ui.waitMessage(secEl) : null;
        if (overlay) overlay.style.borderRadius = '5px';
        getJSON('/getSecurity', (err, securityCfg) => {
            if (overlay) overlay.remove();
            if (err) ui.serviceError(err);
            else general.setSecurityConfig(securityCfg);
        });
    }
    setHomePanel() {
        let divCfg = get('divConfigPnl');
        let divHome = get('divHomePnl');
        if (divHome) divHome.style.display = '';
        if (divCfg) divCfg.style.display = 'none';
        if (typeof somfy !== 'undefined') {
            somfy.checkEmptyState();
            somfy.refreshHomeChrome();
        }
        const use = document.querySelector('#btnConfig use');
        if (use) use.setAttribute('href', '#svg-tabSettings');
        this.setShellMode('home');
        if (sockIsOpen) socket.send('leave:0');
        general.setSecurityConfig({ type: 0, username: '', password: '', pin: '', permissions: 0 });
    }
    toggleConfig() {
        if (this.isConfigOpen()) this.goHome();
        else this.goSettings();
        if (typeof somfy !== 'undefined') {
            somfy.showEditShade(false);
            somfy.showEditGroup(false);
        }
    }
    showNetworkConfig() { this.openSettingsSection('divNetworkSettings'); }
    showRadioConfig() { this.openSettingsSection('divRadioSettings'); }
    showSystemConfig() { this.openSettingsSection('divSystemSettings'); }
    showShadeConfig() {
        this.openSettingsSection('divSomfySettings');
        const motorTab = document.querySelector('.subtab-container [data-grpid="divSomfyMotors"]');
        if (motorTab) this.selectTab(motorTab);
        if (typeof somfy !== 'undefined') {
            somfy.showEditShade(true);
            somfy.openEditShade();
        }
    }
    setWelcomeChip(id, done) {
        const chip = get(id);
        if (chip) chip.classList.toggle('is-done', !!done);
    }
    updateWelcomeChecklist() {
        const netOk = !!(typeof wifi !== 'undefined' && wifi.linkUp);
        const cfg = (typeof somfy !== 'undefined' && somfy.transceiver && somfy.transceiver.config) ? somfy.transceiver.config : null;
        const radioOk = !!(cfg && cfg.radioInit);
        const ready = netOk && radioOk;

        const netStep = get('welcomeStepNet');
        const radStep = get('welcomeStepRadio');
        if (netStep) netStep.hidden = !!netOk;
        if (radStep) radStep.hidden = !!radioOk;
        const setup = get('welcomeSetupList');
        if (setup) setup.hidden = !!ready;

        this.setWelcomeChip('welcomeChipNet', netOk);
        this.setWelcomeChip('welcomeChipRadio', radioOk);

        const title = get('welcomeTitle');
        const desc = get('welcomeDesc');
        const titleKey = ready ? 'WELCOME_EMPTY_TITLE' : 'WELCOME';
        const descKey = ready ? 'WELCOME_DESC_READY' : 'WELCOME_DESC';
        if (title) {
            title.setAttribute('tr', titleKey);
            title.textContent = tr(titleKey);
        }
        if (desc) {
            desc.setAttribute('tr', descKey);
            desc.textContent = tr(descKey);
        }
    }
}
var ui = new UIBinder();
class Security {
    type = 0;
    authenticated = false;
    apiKey = '';
    permissions = 0;
    setLoginVisible(show) {
        const pnl = get('divUnauthenticated');
        if (pnl) pnl.style.display = show ? 'flex' : 'none';
        document.documentElement.classList.toggle('login-required', !!show);
    }
    async init() {
        let fld = get('divUnauthenticated').querySelector('.pin-digit[data-bind="security.pin.d0"]');
        get('divUnauthenticated').querySelector('.pin-digit[data-bind="login.pin.d3"]').addEventListener('digitentered', (evt) => {
            security.login();
        });
        document.documentElement.classList.add('login-required');
        await this.loadContext();
        if (this.type === 0 || (this.permissions & 0x01) === 0x01) { // No login required or only the config is protected.
            if (typeof socket === 'undefined' || !socket) (async () => { await initSockets(); })();
            //ui.setMode(mode);
            this.setLoginVisible(false);
            get('divAuthenticated').style.display = '';
            get('divContainer').setAttribute('data-auth', true);
        }
    }
    async loadContext() {
        const pnl = get('divUnauthenticated');
        if (!pnl) return;

        // Cache groupé des éléments de login
        const qs = (s) => pnl.querySelector(s);
        const btn = qs('#loginButtons'), pwd = qs('#divLoginPassword'), pin = qs('#divLoginPin');
        btn.style.display = pwd.style.display = pin.style.display = 'none';

        return new Promise(res => {
            loadLang(() => {
                getJSONSync('/loginContext', (err, ctx) => {
                    if (err) return ui.serviceError(err), res();

                    // Uptime & Info CPU
                    if (ctx.uptime != null || ctx.netUptime != null) {
                        uptimeClock.set(ctx.uptime, ctx.netUptime);
                    }
                    if (typeof wifi !== 'undefined' && wifi.applyLoginContext) wifi.applyLoginContext(ctx);
                    if (ctx.version) general.setTopVersion(ctx.version);
                    if (ctx.cpuFreq) get('info-cpu').textContent = `${ctx.cores > 1 ? 'Dual' : 'Single'}-Core @ ${ctx.cpuFreq} ${tr('MHZ')}`;
                    // Flash & FileSystem (Regroupé)
                    if (ctx.flashSize) {
                        get('info-flash').innerHTML = `<span>${tr('FW_TOTAL')}: </span><span class="status-detail">${ctx.flashSize}</span> Mo (<span class="hide550">${tr('FW_SPEED')}: </span><span class="status-detail">${ctx.flashSpeed}</span> ${tr('MHZ')})`;
                    }
                    if (ctx.fsTotal) {
                        const free = ctx.fsTotal - ctx.fsUsed, pct = Math.round((ctx.fsUsed / ctx.fsTotal) * 100);
                        const el = get('info-fs-status');
                        if (el) el.innerHTML = `<span class="status-detail">${free}</span> ${tr('FW_UNIT_KO')} ${tr('FW_FREE_SUFFIX')}<span class="hide550"> ${tr('FW_ON')} <span class="status-detail">${ctx.fsTotal}</span></span>`;
                        const elP = get('info-fs-pct');
                        if (elP) elP.innerHTML = `${tr('FW_USED_AT')} <span class="status-detail">${pct}</span>%`;
                    }
                    // MAC Addresses
                    if (ctx.mac) document.querySelectorAll('.spanMacAddress').forEach(el => el.textContent = ctx.mac);

                    this.type = ctx.type;
                    this.permissions = ctx.permissions;
                    const roles = ['unset', 'router', 'repeater'];
                    document.documentElement.setAttribute('data-mesh-role', roles[ctx.meshRole] || 'unset');
                    document.documentElement.setAttribute('data-mesh-connected', ctx.connected ? '1' : '0');

                    const cont = get('divContainer');
                    if (cont) cont.setAttribute('data-securitytype', ctx.type);
                    // Gestion du Login
                    if (ctx.type !== 0) {
                        btn.style.display = '';
                        const fld = ctx.type === 1 ? qs('.pin-digit[data-bind="login.pin.d0"]') : qs('#fldLoginUsername');
                        const targetDiv = ctx.type === 1 ? pin : pwd;

                        targetDiv.style.display = '';
                        if (fld) setTimeout(() => fld.focus(), 100);

                        const typeFld = qs('#fldLoginType');
                        if (typeFld) typeFld.value = ctx.type;
                        this.setLoginVisible(true);
                    }
                    res();
                });
            });
        });
    }
    authUser() {
        get('divAuthenticated').style.display = 'none';
        this.setLoginVisible(true);
        this.loadContext();
        get('btnCancelLogin').style.display = 'inline-block';
    }
    cancelLogin() {
        let evt = new CustomEvent('afterlogin', { detail: { authenticated: this.authenticated } });
        get('divAuthenticated').style.display = '';
        this.setLoginVisible(false);
        get('divContainer').dispatchEvent(evt);
    }
    login() {
        console.log('Logging in...');
        let pnl = get('divUnauthenticated');
        let msg = pnl.querySelector('#spanLoginMessage');
        msg.innerHTML = '';
        let sec = ui.fromElement(pnl).login;
        console.log(sec);
        let pin = '';
        switch (sec.type) {
            case 1:
                for (let i = 0; i < 4; i++) {
                    pin += sec.pin[`d${i}`];
                }
                if (pin.length !== 4) return;
                break;
            case 2:
                break;
        }
        sec.pin = pin;
        putJSONSync('/login', sec, (err, log) => {
            if (err) ui.serviceError(err);
            else {
                console.log(log);
                if (log.success) {
                    if (typeof socket === 'undefined' || !socket) (async () => { await initSockets(); })();

                    this.setLoginVisible(false);
                    get('divAuthenticated').style.display = '';
                    get('divContainer').setAttribute('data-auth', true);
                    this.apiKey = log.apiKey;
                    this.authenticated = true;
                    let evt = new CustomEvent('afterlogin', { detail: { authenticated: true } });
                    get('divContainer').dispatchEvent(evt);
                    if (typeof mesh !== 'undefined') mesh.onLoggedIn();
                }
                else
                    msg.innerHTML = tr(log.msg);
            }
        });
    }
    toggleFieldPassword(fieldId, el) {
        const fld = get(fieldId);
        const ico = el.querySelector('use');

        if (fld.type === 'password') {
            fld.type = 'text';
            if(ico) ico.setAttribute('href', '#svg-eyeOn');
        } else {
            fld.type = 'password';
            if(ico) ico.setAttribute('href', '#icon-eyeOff');
        }
    }
}
var security = new Security();
class General {
    initialized = false;
    appVersion = '';
    reloadApp = false;
    rebooting = false;
    init() {
        if (this.initialized) return;

        const savedTheme = this.normalizeThemeId(localStorage.getItem('themeMode') || 'ocean');
        this.applyTheme(savedTheme);
        this.applyShadeView(localStorage.getItem('shadeView') || 'large');
        this.applyRfTxDebug(localStorage.getItem('rfTxDebug') === '1');
        const savedColor = localStorage.getItem('accentColor') || '#009BFF';
        document.documentElement.style.setProperty('--accent-color', savedColor);
        // Keep Auto theme in sync when OS appearance changes.
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                if (this.normalizeThemeId(localStorage.getItem('themeMode') || 'auto') === 'auto') {
                    this.applyTheme('auto');
                }
            });
        }
        this.setAppVersion();
        this.setTimeZones();
        if (sockIsOpen && ui.isConfigOpen()) socket.send('join:0');
        ui.toElement(get('divSystemSettings'), {
            general: { hostname: 'ESPSomfyRTS', username: '', password: '', posixZone: 'UTC0', ntpServer: 'pool.ntp.org' }
        });

        this.initialized = true;
    }
    normalizeThemeId(val) {
        const map = {
            '0': 'auto',
            '1': 'apple-dark',
            '2': 'apple-light',
            dark: 'apple-dark',
            light: 'apple-light'
        };
        const id = map[val] || val || 'ocean';
        const allowed = [
            'auto', 'apple-light', 'apple-dark', 'graphite', 'sunset', 'mint',
            'ocean', 'midnight', 'forest', 'rose', 'sand', 'slate', 'nord', 'solar', 'lavender', 'contrast'
        ];
        return allowed.includes(id) ? id : 'ocean';
    }
    resolveThemeId(val) {
        const id = this.normalizeThemeId(val);
        if (id !== 'auto') return id;
        return window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'apple-dark'
            : 'apple-light';
    }
    applyTheme(val) {
        const stored = this.normalizeThemeId(val);
        localStorage.setItem('themeMode', stored);
        document.documentElement.setAttribute('data-theme', this.resolveThemeId(stored));
        // Theme pack sets default accent; keep user accent override if present.
        const savedColor = localStorage.getItem('accentColor') || '#009BFF';
        document.documentElement.style.setProperty('--accent-color', savedColor);
        const sel = get('selThemeMode');
        if (sel) sel.value = stored;
    }
    onModeThemeChanged() {
        const sel = get('selThemeMode');
        if (!sel) return;
        this.applyTheme(sel.value);
    }
    normalizeShadeView(val) {
        return (val === 'small' || val === 'compact' || val === 'large') ? val : 'large';
    }
    applyShadeView(val) {
        const view = this.normalizeShadeView(val);
        localStorage.setItem('shadeView', view);
        document.documentElement.setAttribute('data-shade-view', view);
        document.querySelectorAll('.shade-view-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === view);
        });
    }
    applyRfTxDebug(on) {
        const enabled = !!on;
        localStorage.setItem('rfTxDebug', enabled ? '1' : '0');
        const cb = get('cbRfTxDebug');
        if (cb) cb.checked = enabled;
        const pane = get('divTxDebugFloat');
        if (!pane) return;
        pane.classList.toggle('is-open', enabled);
        pane.style.display = '';
        pane.setAttribute('aria-hidden', enabled ? 'false' : 'true');
        if (enabled) {
            pane.classList.toggle('minimized', localStorage.getItem('rfTxDebugMin') === '1');
            this.restoreRfTxDebugGeom();
            this.initRfTxDebugDrag();
            const list = get('divTxFrames');
            if (list && !list.querySelector('.tx-debug-row')) {
                this.renderTxDebugEmpty(list);
            }
            this.refreshTxDebugChrome();
        }
    }
    onRfTxDebugChanged() {
        const cb = get('cbRfTxDebug');
        this.applyRfTxDebug(!!(cb && cb.checked));
    }
    renderTxDebugEmpty(list) {
        const el = list || get('divTxFrames');
        if (!el) return;
        el.innerHTML = '<div class="tx-debug-empty" tr="TX_DEBUG_EMPTY">Waiting for TX… press Up/Down/My</div>';
    }
    refreshTxDebugChrome() {
        const list = get('divTxFrames');
        const count = get('spanTxDebugCount');
        const n = list ? list.querySelectorAll('.tx-debug-row').length : 0;
        if (count) count.textContent = n ? String(n) : '';
    }
    toggleRfTxDebugMin() {
        const pane = get('divTxDebugFloat');
        if (!pane) return;
        const min = !pane.classList.contains('minimized');
        pane.classList.toggle('minimized', min);
        localStorage.setItem('rfTxDebugMin', min ? '1' : '0');
        if (min) {
            pane.style.width = '';
            pane.style.height = '';
        } else {
            this.restoreRfTxDebugGeom();
        }
    }
    restoreRfTxDebugGeom() {
        const pane = get('divTxDebugFloat');
        if (!pane) return;
        try {
            const pos = JSON.parse(localStorage.getItem('rfTxDebugPos') || 'null');
            if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
                const maxL = Math.max(0, window.innerWidth - 80);
                const maxT = Math.max(0, window.innerHeight - 40);
                pane.style.left = Math.min(Math.max(0, pos.left), maxL) + 'px';
                pane.style.top = Math.min(Math.max(0, pos.top), maxT) + 'px';
                pane.style.right = 'auto';
                pane.style.bottom = 'auto';
            }
            if (!pane.classList.contains('minimized')) {
                const sz = JSON.parse(localStorage.getItem('rfTxDebugSize') || 'null');
                if (sz && typeof sz.width === 'number' && typeof sz.height === 'number') {
                    pane.style.width = Math.min(Math.max(320, sz.width), window.innerWidth - 16) + 'px';
                    pane.style.height = Math.min(Math.max(160, sz.height), window.innerHeight - 16) + 'px';
                }
            }
        } catch (e) { /* ignore bad saved geom */ }
    }
    saveRfTxDebugGeom() {
        const pane = get('divTxDebugFloat');
        if (!pane) return;
        const rect = pane.getBoundingClientRect();
        localStorage.setItem('rfTxDebugPos', JSON.stringify({ left: rect.left, top: rect.top }));
        if (!pane.classList.contains('minimized')) {
            localStorage.setItem('rfTxDebugSize', JSON.stringify({ width: rect.width, height: rect.height }));
        }
    }
    initRfTxDebugDrag() {
        const pane = get('divTxDebugFloat');
        const header = get('divTxDebugHeader');
        const grip = get('divTxDebugResize');
        if (!pane || !header || header.dataset.dragBound === '1') return;
        header.dataset.dragBound = '1';
        let mode = '';
        let ox = 0, oy = 0, startW = 0, startH = 0;
        const onMove = (ev) => {
            if (!mode) return;
            const pt = ev.touches ? ev.touches[0] : ev;
            if (mode === 'drag') {
                let left = pt.clientX - ox;
                let top = pt.clientY - oy;
                const maxL = Math.max(0, window.innerWidth - pane.offsetWidth);
                const maxT = Math.max(0, window.innerHeight - 36);
                left = Math.min(Math.max(0, left), maxL);
                top = Math.min(Math.max(0, top), maxT);
                pane.style.left = left + 'px';
                pane.style.top = top + 'px';
                pane.style.right = 'auto';
                pane.style.bottom = 'auto';
            } else if (mode === 'resize') {
                const w = Math.min(Math.max(320, startW + (pt.clientX - ox)), window.innerWidth - 16);
                const h = Math.min(Math.max(160, startH + (pt.clientY - oy)), window.innerHeight - 16);
                pane.style.width = w + 'px';
                pane.style.height = h + 'px';
            }
            if (ev.cancelable) ev.preventDefault();
        };
        const onUp = () => {
            if (!mode) return;
            mode = '';
            this.saveRfTxDebugGeom();
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
        };
        const start = (ev, next) => {
            const pt = ev.touches ? ev.touches[0] : ev;
            const rect = pane.getBoundingClientRect();
            mode = next;
            if (next === 'drag') {
                ox = pt.clientX - rect.left;
                oy = pt.clientY - rect.top;
            } else {
                ox = pt.clientX;
                oy = pt.clientY;
                startW = rect.width;
                startH = rect.height;
            }
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onUp);
        };
        header.addEventListener('mousedown', (ev) => {
            if (ev.target.closest('.tx-debug-actions')) return;
            start(ev, 'drag');
        });
        header.addEventListener('touchstart', (ev) => {
            if (ev.target.closest('.tx-debug-actions')) return;
            start(ev, 'drag');
        }, { passive: true });
        if (grip) {
            grip.addEventListener('mousedown', (ev) => { ev.stopPropagation(); start(ev, 'resize'); });
            grip.addEventListener('touchstart', (ev) => { ev.stopPropagation(); start(ev, 'resize'); }, { passive: true });
        }
    }
    getCookie(cname) {
        let n = cname + '=';
        let cookies = document.cookie.split(';');
        console.log(cookies);
        for (let i = 0; i < cookies.length; i++) {
            let c = cookies[i];
            while (c.charAt(0) === ' ') c = c.substring(0);
            if (c.indexOf(n) === 0) return c.substring(n.length, c.length);
        }
        return '';
    }
    reload() {
        let addMetaTag = (name, content) => {
            let meta = document.createElement('meta');
            meta.httpEquiv = name;
            meta.content = content;
            document.getElementsByTagName('head')[0].appendChild(meta);
        };
        addMetaTag('pragma', 'no-cache');
        addMetaTag('expires', '0');
        addMetaTag('cache-control', 'no-cache');
        document.location.reload();
    }
    timeZones = [
        "Africa/Cairo|EET-2",
        "Africa/Johannesburg|SAST-2",
        "Africa/Juba|CAT-2",
        "Africa/Lagos|WAT-1",
        "Africa/Mogadishu|EAT-3",
        "Africa/Tunis|CET-1",
        "America/Adak|HST10HDT,M3.2.0,M11.1.0",
        "America/Anchorage|AKST9AKDT,M3.2.0,M11.1.0",
        "America/Asuncion|<-04>4<-03>,M10.1.0/0,M3.4.0/0",
        "America/Bahia_Banderas|CST6CDT,M4.1.0,M10.5.0",
        "America/Barbados|AST4",
        "America/Bermuda|AST4ADT,M3.2.0,M11.1.0",
        "America/Cancun|EST5",
        "America/Central_Time|CST6CDT,M3.2.0,M11.1.0",
        "America/Chihuahua|MST7MDT,M4.1.0,M10.5.0",
        "America/Eastern_Time|EST5EDT,M3.2.0,M11.1.0",
        "America/Godthab|<-03>3<-02>,M3.5.0/-2,M10.5.0/-1",
        "America/Havana|CST5CDT,M3.2.0/0,M11.1.0/1",
        "America/Mexico_City|CST6",
        "America/Miquelon|<-03>3<-02>,M3.2.0,M11.1.0",
        "America/Mountain_Time|MST7MDT,M3.2.0,M11.1.0",
        "America/Pacific_Time|PST8PDT,M3.2.0,M11.1.0",
        "America/Phoenix|MST7",
        "America/Santiago|<-04>4<-03>,M9.1.6/24,M4.1.6/24",
        "America/St_Johns|NST3:30NDT,M3.2.0,M11.1.0",
        "Antarctica/Troll|<+00>0<+02>-2,M3.5.0/1,M10.5.0/3",
        "Asia/Amman|EET-2EEST,M2.5.4/24,M10.5.5/1",
        "Asia/Beirut|EET-2EEST,M3.5.0/0,M10.5.0/0",
        "Asia/Colombo|<+0530>-5:30",
        "Asia/Damascus|EET-2EEST,M3.5.5/0,M10.5.5/0",
        "Asia/Gaza|EET-2EEST,M3.4.4/50,M10.4.4/50",
        "Asia/Hong_Kong|HKT-8",
        "Asia/Jakarta|WIB-7",
        "Asia/Jayapura|WIT-9",
        "Asia/Jerusalem|IST-2IDT,M3.4.4/26,M10.5.0",
        "Asia/Kabul|<+0430>-4:30",
        "Asia/Karachi|PKT-5",
        "Asia/Kathmandu|<+0545>-5:45",
        "Asia/Kolkata|IST-5:30",
        "Asia/Makassar|WITA-8",
        "Asia/Manila|PST-8",
        "Asia/Seoul|KST-9",
        "Asia/Shanghai|CST-8",
        "Asia/Tehran|<+0330>-3:30",
        "Asia/Tokyo|JST-9",
        "Atlantic/Azores|<-01>1<+00>,M3.5.0/0,M10.5.0/1",
        "Australia/Adelaide|ACST-9:30ACDT,M10.1.0,M4.1.0/3",
        "Australia/Brisbane|AEST-10",
        "Australia/Darwin|ACST-9:30",
        "Australia/Eucla|<+0845>-8:45",
        "Australia/Lord_Howe|<+1030>-10:30<+11>-11,M10.1.0,M4.1.0",
        "Australia/Melbourne|AEST-10AEDT,M10.1.0,M4.1.0/3",
        "Australia/Perth|AWST-8",
        "Etc/GMT-1|<+01>-1",
        "Etc/GMT-2|<+02>-2",
        "Etc/GMT-3|<+03>-3",
        "Etc/GMT-4|<+04>-4",
        "Etc/GMT-5|<+05>-5",
        "Etc/GMT-6|<+06>-6",
        "Etc/GMT-7|<+07>-7",
        "Etc/GMT-8|<+08>-8",
        "Etc/GMT-9|<+09>-9",
        "Etc/GMT-10|<+10>-10",
        "Etc/GMT-11|<+11>-11",
        "Etc/GMT-12|<+12>-12",
        "Etc/GMT-13|<+13>-13",
        "Etc/GMT-14|<+14>-14",
        "Etc/GMT+0|GMT0",
        "Etc/GMT+1|<-01>1",
        "Etc/GMT+2|<-02>2",
        "Etc/GMT+3|<-03>3",
        "Etc/GMT+4|<-04>4",
        "Etc/GMT+5|<-05>5",
        "Etc/GMT+6|<-06>6",
        "Etc/GMT+7|<-07>7",
        "Etc/GMT+8|<-08>8",
        "Etc/GMT+9|<-09>9",
        "Etc/GMT+10|<-10>10",
        "Etc/GMT+11|<-11>11",
        "Etc/GMT+12|<-12>12",
        "Etc/UTC|UTC0",
        "Europe/Athens|EET-2EEST,M3.5.0/3,M10.5.0/4",
        "Europe/Berlin|CEST-1CET,M3.2.0/2:00:00,M11.1.0/2:00:00",
        "Europe/Brussels|CET-1CEST,M3.5.0,M10.5.0/3",
        "Europe/Chisinau|EET-2EEST,M3.5.0,M10.5.0/3",
        "Europe/Dublin|IST-1GMT0,M10.5.0,M3.5.0/1",
        "Europe/Lisbon|WET0WEST,M3.5.0/1,M10.5.0",
        "Europe/London|GMT0BST,M3.5.0/1,M10.5.0",
        "Europe/Moscow|MSK-3",
        "Europe/Paris|CET-1CEST-2,M3.5.0/02:00:00,M10.5.0/03:00:00",
        "Indian/Cocos|<+0630>-6:30",
        "Pacific/Auckland|NZST-12NZDT,M9.5.0,M4.1.0/3",
        "Pacific/Chatham|<+1245>-12:45<+1345>,M9.5.0/2:45,M4.1.0/3:45",
        "Pacific/Easter|<-06>6<-05>,M9.1.6/22,M4.1.6/22",
        "Pacific/Fiji|<+12>-12<+13>,M11.2.0,M1.2.3/99",
        "Pacific/Guam|ChST-10",
        "Pacific/Honolulu|HST10",
        "Pacific/Marquesas|<-0930>9:30",
        "Pacific/Midway|SST11",
        "Pacific/Norfolk|<+11>-11<+12>,M10.1.0,M4.1.0/3"
    ];
    loadGeneral() {
        getJSONSync('/modulesettings', (err, settings) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log("Settings received:", settings);
            if (typeof somfy !== 'undefined') somfy.initPins();

            get('spanFwVersion').innerText = settings.fwVersion;
            get('spanHwVersion').innerText = settings.chipModel.length > 0 ? '-' + settings.chipModel : '';
            get('divContainer').setAttribute('data-chipmodel', settings.chipModel);

            this.applyServerVersions(settings);
            this.setAppVersion();

            loadLang(() => {
                document.documentElement.lang = 'en';
                ui.toElement(get('divSystemSettings'), { general: settings });
                this.general = settings;
                this.refreshAlexaHueCount();
            });
            if (settings.accentColor) {
                document.documentElement.style.setProperty('--accent-color', settings.accentColor);
                localStorage.setItem('accentColor', settings.accentColor);

                const accentInput = get('fldAccentColor');
                if (accentInput) {
                    accentInput.value = settings.accentColor;
                    accentInput.addEventListener('input', (e) => {
                        document.documentElement.style.setProperty('--accent-color', e.target.value);
                        localStorage.setItem('accentColor', e.target.value);
                    });
                }
            }
            this.applyRfTxDebug(localStorage.getItem('rfTxDebug') === '1');

        });
    }
    loadLogin() {
        const savedColor = localStorage.getItem('accentColor') || '#009BFF';
        document.documentElement.style.setProperty('--accent-color', savedColor);
        getJSONSync('/loginContext', (err, ctx) => {
            if (err) ui.serviceError(err);
            else {
                console.log(ctx);
                let pnl = get('divContainer');
                pnl.setAttribute('data-securitytype', ctx.type);
                let fld;
                switch (ctx.type) {
                    case 1:
                        get('divPinSecurity').style.display = '';
                        fld = get('divPinSecurity').querySelector('.pin-digit[data-bind="security.pin.d0"]');
                        get('divPinSecurity').querySelector('.pin-digit[data-bind="security.pin.d3"]').addEventListener('digitentered', (evt) => {
                            general.login();
                        });
                        break;
                    case 2:
                        get('divPasswordSecurity').style.display = '';
                        fld = get('fldUsername');
                        break;
                }
                if (fld) fld.focus();
            }
        });
    }
    setAppVersion() {
        const el = get('spanAppVersion');
        if (el) el.innerText = this.appVersion || '—';
    }
    setTopVersion(ver) {
        const v = (ver || '').toString().trim();
        if (!v) return;
        document.querySelectorAll('.js-top-version').forEach((el) => { el.textContent = v; });
    }
    applyServerVersions(settings) {
        if (!settings) return;
        if (settings.fwVersion) {
            const el = get('spanFwVersion');
            if (el) el.innerText = settings.fwVersion;
            this.setTopVersion(settings.fwVersion);
        }
        const app = typeof settings.appVersion === 'string'
            ? settings.appVersion
            : (settings.appVersion && settings.appVersion.name);
        if (app) this.appVersion = app;
        this.setAppVersion();
    }
    refreshVersions() {
        return new Promise((resolve) => {
            getJSONSync('/modulesettings', (err, settings) => {
                if (!err && settings) this.applyServerVersions(settings);
                resolve(settings || null);
            });
        });
    }
    setTimeZones() {
        const dd = get('selTimeZone');
        dd.innerHTML = this.timeZones.map(tz => {
            const [city, code] = tz.split('|');
            return `<option value="${code}">${city}</option>`;
        }).join('');

        dd.value = 'UTC0';
    }
    setGeneral() {
        let valid = true;
        let pnl = get('divSystemSettings');
        let obj = ui.fromElement(pnl).general;
        const msg = tr('ERR_HOSTNAME');
        if (typeof obj.hostname === 'undefined' || !obj.hostname || obj.hostname === '') {
            ui.errorMessage(msg).querySelector('.sub-message').innerHTML = tr('ERR_INVALID_HOSTNAME');
            valid = false;
        }
        if (valid && !/^[a-zA-Z0-9-]+$/.test(obj.hostname)) {
            ui.errorMessage(msg).querySelector('.sub-message').innerHTML = tr('ERR_HOSTNAME_CHARS');
            valid = false;
        }
        if (valid && obj.hostname.length > 32) {
            ui.errorMessage(msg).querySelector('.sub-message').innerHTML = tr('ERR_HOSTNAME_LENGTH');
            valid = false;
        }
        if (valid && typeof obj.ntpServer === 'string' && obj.ntpServer.length > 64) {
            ui.errorMessage(msg).querySelector('.sub-message').innerHTML = tr('ERR_NTP_LENGTH');
            valid = false;
        }
        if (valid) {
            this.onRfTxDebugChanged();
            putJSONSync('/setgeneral', obj, (err, response) => {
                if (err) {
                    ui.serviceError(err);
                } else {
                    ui.successMessage(tr('MSG_SAVE_SUCCESS'));
                    console.log(response);
                }
            });
        }
    }
    setUpdatePrefs() {
        const check = !!get('cbCheckForUpdate')?.checked;
        const autoInst = !!get('cbAutoInstallUpdate')?.checked;
        if (autoInst && get('cbCheckForUpdate')) get('cbCheckForUpdate').checked = true;
        putJSONSync('/setgeneral', {
            checkForUpdate: autoInst ? true : check,
            autoInstallUpdate: autoInst
        }, (err) => {
            if (err) ui.serviceError(err);
        });
    }
    setAlexaHuePrefs() {
        if (typeof alexa !== 'undefined') alexa.setEnabled(!!get('cbAlexaHueEnabled')?.checked);
    }
    refreshAlexaHueCount() {
        if (typeof alexa !== 'undefined') alexa.refreshCount();
    }
    setSecurityConfig(security) {
        let obj = {
            security: {
                type: security.type, username: security.username, password: security.password,
                permissions: { configOnly: makeBool(security.permissions & 0x01) },
                pin: {
                    d0: security.pin[0],
                    d1: security.pin[1],
                    d2: security.pin[2],
                    d3: security.pin[3]
                }
            }
        };
        ui.toElement(get('divSecurityOptions'), obj);
        this.onSecurityTypeChanged();
    }
    showRebootWait(msg) {
        this.rebooting = true;
        document.querySelectorAll('.reboot-wait-overlay').forEach(el => el.remove());
        const text = msg || tr('MSG_REBOOTING') || REBOOT_WAIT_FALLBACK;
        const div = ui.waitMessage(document.body, text);
        div.classList.add('reboot-wait-overlay');
        div.style.zIndex = '20000';
        return div;
    }
    rebootDevice() {
        ui.promptMessage(get('divContainer'), tr('PROMPT_REBOOT_CONFIRM'), () => {
            this.showRebootWait();
            if(typeof socket !== 'undefined') socket.close(3000, 'reboot');
            putJSONSync('/reboot', {}, (err, response) => {
                get('btnSaveGeneral')?.classList.remove('disabled');
                console.log(response);
            });
            ui.clearErrors();
        });
    }
    resetOriginal() {
        ui.promptMessage(get('divContainer'), tr('PROMPT_RESET_ORIGINAL'), () => {
            putJSONSync('/mesh/resetOriginal', {}, (err) => {
                if (err) return ui.serviceError(err);
                document.documentElement.setAttribute('data-mesh-role', 'unset');
                this.showRebootWait();
                if (typeof socket !== 'undefined') socket.close(3000, 'reboot');
                putJSONSync('/reboot', {}, () => {});
            });
        });
    }
    onSecurityTypeChanged() {
        let pnl = get('divSecurityOptions'),
        type = ui.fromElement(pnl).security.type,
        // [Permissions, Pin, Password] - Type (0, 1 ou 2)
        states = [
            ['none', 'none', 'none'],
            ['',     '',     'none'],
            ['',     'none', '']
        ][type];

        ['#divPermissions', '#divPinSecurity', '#divPasswordSecurity'].forEach((id, i) => {
            pnl.querySelector(id).style.display = states[i];
        });
    }
    saveSecurity() {
        const s = ui.fromElement(get('divSecurityOptions')).security;
        const pin = [0, 1, 2, 3].map(i => s.pin[`d${i}`]).join('');
        const data = {
            type: s.type, username: s.username, password: s.password, pin,
            perm: s.permissions.configOnly ? 1 : 0,
            permissions: s.permissions.configOnly ? 0x01 : 0x00
        };
        let confirmText = '';
        if (s.type === 1) {
            if (pin.length !== 4) return this.secError('ERR_PIN_INVALID', 'ERR_PIN_INVALID_DESC');
            confirmText = `<p>${tr('SAVESECURITY_PIN_WARNING')}</p><p>${tr('SAVESECURITY_PIN_CONFIRM')}</p>`;
        }
        else if (s.type === 2) {
            if (!s.username) return this.secError('ERR_USERNAME_MISSING', 'ERR_USERNAME_MISSING_DESC');
            if (s.password !== s.repeatpassword) return this.secError('ERR_PASSWORD_MISMATCH', 'ERR_PASSWORD_MISMATCH_DESC');
            confirmText = `<p>${tr('SAVESECURITY_PASSWORD_WARNING')}</p><p>${tr('SAVESECURITY_PASSWORD_CONFIRM')}</p>`;
        }
        const prompt = ui.promptMessage(tr('PROMPT_SECURITY_CONFIRM'), () => {
            putJSONSync('/saveSecurity', data, (e) => {
                prompt.remove();
                if (e) ui.serviceError(e);
            });
        });
        prompt.querySelector('.sub-message').innerHTML = confirmText;
    }
    secError(title, desc) {
        ui.errorMessage(tr(title)).querySelector('.sub-message').innerHTML = tr(desc);
    }
    showHAOverlay() {
        const div = document.createElement('div');
        div.id = 'divHAConfig';
        div.className = 'inst-overlay';

        div.innerHTML = `
        <div class="instructions-content">
        <div class="overlay-scroll-content">
        ${overlayHeader(tr('HACS'), tr('HACS_DESC'), 'svg-homeAssistant')}
        <p><strong>${tr('HACS_PURPOSE_TITLE')}</strong></p>
        <p>${tr('HACS_PURPOSE_TEXT_1')}</p>
        <p>${tr('HACS_PURPOSE_TEXT_2')}</p>
        <p class="ha-section-title"><strong>${tr('HACS_INSTALL_TITLE')}</strong></p>
        <ol class="ha-install-list">
        <li>${tr('HACS_INSTALL_STEP_1')}</li>
        <li>${tr('HACS_INSTALL_STEP_2')}</li>
        <li>${tr('HACS_INSTALL_STEP_3')}</li>
        <li>${tr('HACS_INSTALL_STEP_4')}</li>
        </ol>
        <div class="warning ha-warning-note">
        <svg><use href="#svg-warning"></use></svg>
        <div>
        <span>
        ${tr('HACS_REQ_START')}
        <a href="https://www.home-assistant.io" target="_blank" style="color: inherit; text-decoration: underline;"><strong>Home Assistant</strong></a>
        ${tr('HACS_REQ_MID')}
        <a href="https://hacs.xyz" target="_blank" style="color: inherit; text-decoration: underline;"><strong>HACS</strong></a> ${tr('HACS_REQ_END')}
        </span>
        </div>
        </div>
        <div class="ha-badge-container">
        <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=jcvsite&repository=ESPSomfy-RTS-HA&category=integration" target="_blank" class="ha-badge-button">
        <span class="ha-badge-text-main">Open HACS repository on</span>
        <span class="ha-badge-pill"><span class="ha-badge-text-pill">MY</span><svg width="18" height="18"><use href="#svg-homeAssistant"></use></svg></span>
        </a>
        <p class="ha-github-link-container">
        ${tr('HACS_OR_VISIT')} <a href="https://github.com/jcvsite/ESPSomfy-RTS-HA" target="_blank" class="linkSoft">GitHub repository</a>
        </p>
        </div>
        </div>
        <div class="hrDivFooter"></div>
         <div class="button-container-overlay">
        <button id="btnCloseHA" type="button" onclick="closeOverlay(get('divHAConfig'))">${tr('BT_CLOSE')}</button>
        </div>
        </div>`;

        shOverlay(div);
    }
}
var general = new General();

class Wifi {
    initialized = false;
    ethBoardTypes = [];
    ethClockModes = [];
    ethPhyTypes = [];
    connKind = 'wifi';
    linkUp = false;
    netInfo = { kind: 'wifi', ssid: '', ip: '', hostname: '', gateway: '', channel: -1, rssi: -100, speed: 0, duplex: false };

    init() {
        this.ethBoardTypes = [
            { val: 0, label: tr("MANUAL_SETTINGS") || "Configuration Manuelle" },
            { val: 1, label: 'WT32-ETH01 - Wireless Tag', clk: 0, ct: 0, addr: 1, pwr: 16, mdc: 23, mdio: 18 },
            { val: 7, label: 'EST-PoE-32 - Everything Smart', clk: 3, ct: 0, addr: 0, pwr: 12, mdc: 23, mdio: 18 },
            { val: 3, label: 'ESP32-EVB - Olimex', clk: 0, ct: 0, addr: 0, pwr: -1, mdc: 23, mdio: 18 },
            { val: 2, label: 'ESP32-POE - Olimex', clk: 3, ct: 0, addr: 0, pwr: 12, mdc: 23, mdio: 18 },
            { val: 4, label: 'T-Internet POE - LILYGO', clk: 3, ct: 0, addr: 0, pwr: 16, mdc: 23, mdio: 18 },
            { val: 5, label: 'wESP32 v7+ - Silicognition', clk: 0, ct: 2, addr: 0, pwr: -1, mdc: 16, mdio: 17 },
            { val: 6, label: 'wESP32 < v7 - Silicognition', clk: 0, ct: 0, addr: 0, pwr: -1, mdc: 16, mdio: 17 }
        ];
        this.ethClockModes = [
            { val: 0, label: 'GPIO0 IN' },
            { val: 1, label: 'GPIO0 OUT' },
            { val: 2, label: 'GPIO16 OUT' },
            { val: 3, label: 'GPIO17 OUT' }
        ];
        this.ethPhyTypes = [
            { val: 0, label: 'LAN8720' },
            { val: 1, label: 'TLK110' },
            { val: 2, label: 'RTL8201' },
            { val: 3, label: 'DP83848' },
            { val: 4, label: 'DM9051' },
            { val: 5, label: 'KZ8081' }
        ];

        const divStrength = get("divNetworkStrength");
        this.procWifiStrength({strength: -100, ssid: '', channel: -1});

        if (this.initialized) return;

        this.loadETHDropdown(get('selETHClkMode'), this.ethClockModes);
        this.loadETHDropdown(get('selETHPhyType'), this.ethPhyTypes);
        this.loadETHDropdown(get('selETHBoardType'), this.ethBoardTypes);

        let addr = [];
        for (let i = 0; i < 32; i++) {
            addr.push({ val: i, label: `PHY ${i}` });
        }
        this.loadETHDropdown(get('selETHAddress'), addr);

        ui.toElement(get('divNetAdapter'), {
            wifi: { ssid: '', passphrase: '' },
            ethernet: {
                boardType: 1,
                wirelessFallback: false,
                dhcp: true,
                dns1: '',
                dns2: '',
                ip: '',
                gateway: ''
            }
        });
        this.onETHBoardTypeChanged(get('selETHBoardType'));
        this.initialized = true;

        const inputPwr = get('inputETHPWRPin');
        if (inputPwr) {
            inputPwr.addEventListener('focus', () => {
                if (inputPwr.value === 'None') {
                    inputPwr.type = 'number';
                    inputPwr.value = -1;
                }
            });
            inputPwr.addEventListener('blur', () => {
                if (inputPwr.value === '-1' || inputPwr.value === '') {
                    inputPwr.type = 'text';
                    inputPwr.value = 'None';
                }
            });
        }
    }
    loadETHPins(sel, type, selected) {
        let arr = [];
        switch (type) {
            case 'power':
                arr.push({ val: -1, label: 'None' });
                break;
        }
        for (let i = 0; i < 36; i++) {
            if (i === 2) continue;
            arr.push({ val: i, label: `GPIO ${i > 9 ? i : '0' + i}` });
        }
        this.loadETHDropdown(sel, arr, selected);
    }
    loadETHDropdown(sel, arr, selected) {
        if (!sel) return;
        while (sel.firstChild) sel.removeChild(sel.firstChild);
        for (let i = 0; i < arr.length; i++) {
            let elem = arr[i];
            sel.options[sel.options.length] = new Option(elem.label, elem.val, elem.val === selected, elem.val === selected);
        }
    }
    onETHBoardTypeChanged(sel) {
        if (!sel) return;
        let type = this.ethBoardTypes.find(elem => parseInt(sel.value, 10) === elem.val);
        if (typeof type !== 'undefined') {
            if (typeof type.ct !== 'undefined') get('selETHPhyType').value = type.ct;
            if (typeof type.clk !== 'undefined') get('selETHClkMode').value = type.clk;
            if (typeof type.addr !== 'undefined') get('selETHAddress').value = type.addr;

            const inputPwr = get('inputETHPWRPin');
            if (inputPwr && typeof type.pwr !== 'undefined') {
                const isNone = (type.pwr === -1);
                if (isNone) {
                    inputPwr.type = 'text';
                    inputPwr.value = 'None';
                } else {
                    inputPwr.type = 'number';
                    inputPwr.value = type.pwr;
                }
                this.togglePowerIcon(isNone);
            }

            if (typeof type.mdc !== 'undefined') get('inputETHMDCPin').value = type.mdc;
            if (typeof type.mdio !== 'undefined') get('inputETHMDIOPin').value = type.mdio;

            get('divETHSettings').style.display = type.val === 0 ? '' : 'none';
        }
    }
    updateEthernetSummary(pinKey, value) {
        const targetLabel = pinKey.replace('Pin', '').toUpperCase() + ':';
        document.querySelectorAll('#divEthernetSummary .gpioRadio-label').forEach(lbl => {
            const text = lbl.textContent.trim();
            if (text === targetLabel) {
                const valSpan = lbl.nextElementSibling;
                if (valSpan && valSpan.classList.contains('gpioRadio-val')) {
                    valSpan.textContent = (value === -1 || value === 'None') ? 'None' : `GPIO${value}`;
                }
            }
        });
    }
    togglePowerIcon(isNone) {
        const btnIcon = document.querySelector('#btnEthPwrShortcut use');
        if (btnIcon) {
            btnIcon.setAttribute('href', isNone ? '#svg-powerOff' : '#svg-power');
        }
    }
    stepGpio(pinKey, direction) {
        const inputEl = get(`inputETH${pinKey}`);

        if (pinKey === 'PWRPin' && inputEl && inputEl.value === 'None' && direction === 1) {
            inputEl.type = 'number';
            inputEl.value = 0;
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            this.updateEthernetSummary('PWRPin', 0);
            this.togglePowerIcon(false); // Mode numérique -> Icône ON
            return;
        }

        const newValue = stepDeviceGpio(pinKey, direction, 'ETH', 'selETHBoardType', val => val === 0, this.pinMaps || [{ name: '', maxPins: 39 }]);

        if (newValue === undefined) return;
        if (pinKey === 'PWRPin' && inputEl) {
            const isNone = (parseInt(newValue, 10) === -1 || newValue === '');
            if (isNone) {
                inputEl.type = 'text';
                inputEl.value = 'None';
            } else {
                inputEl.type = 'number';
            }
            this.togglePowerIcon(isNone);
        }

        this.updateEthernetSummary(pinKey, newValue);
    }
    setPowerToNone() {
        const inputPwr = get('inputETHPWRPin');
        if (!inputPwr) return;
        if (inputPwr.value === 'None') {
            inputPwr.type = 'number';
            inputPwr.value = 0;
            inputPwr.dispatchEvent(new Event('change', { bubbles: true }));
            this.updateEthernetSummary('PWRPin', 0);
            this.togglePowerIcon(false);
            return;
        }
        inputPwr.type = 'text';
        inputPwr.value = -1;
        inputPwr.dispatchEvent(new Event('change', { bubbles: true }));
        inputPwr.type = 'text';
        inputPwr.value = 'None';

        this.updateEthernetSummary('PWRPin', -1);
        this.togglePowerIcon(true); // Mode None -> Icône OFF
    }
    onDHCPClicked(cb) {
        get('divStaticIP').style.display = cb.checked ? 'none' : '';
        this.refreshIpModeLabel(!!cb.checked);
    }
    refreshIpModeLabel(isDhcp) {
        const label = isDhcp
            ? (tr('ADRESSIP_DHCP') || 'DHCP')
            : (tr('ADRESSIP_STATIC_IP') || 'Static');
        const main = get('spanIpMode');
        if (main) main.textContent = label;
        document.querySelectorAll('.spanIpModeEth').forEach(el => { el.textContent = label; });
    }
    toggleIpEdit(force) {
        const ed = get('divDHCP');
        if (!ed) return;
        const open = typeof force === 'boolean' ? force : ed.style.display === 'none';
        ed.style.display = open ? '' : 'none';
        if (open) {
            const dhcp = get('cbDHCP');
            if (dhcp) this.onDHCPClicked(dhcp);
            ed.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    loadNetwork() {
        let pnl = get('divNetAdapter');
        getJSONSync('/networksettings', (err, settings) => {
            console.log(settings);
            if (err) {
                ui.serviceError(err);
            }
            else {
                get('cbHardwired').checked = settings.connType >= 2;
                get('cbFallbackWireless').checked = settings.connType === 3;
                ui.toElement(pnl, settings);

                const inputPwr = get('inputETHPWRPin');
                if (inputPwr && settings.ethernet && settings.ethernet.PWRPin !== undefined) {
                    const pwrVal = parseInt(settings.ethernet.PWRPin, 10);
                    const isNone = (pwrVal === -1);

                    if (isNone) {
                        inputPwr.type = 'text';
                        inputPwr.value = 'None';
                    } else {
                        inputPwr.type = 'number';
                        inputPwr.value = pwrVal;
                    }
                    this.togglePowerIcon(isNone);
                    this.updateEthernetSummary('PWRPin', pwrVal);
                }

                ui.toElement(get('divDHCP'), settings);
                get('divETHSettings').style.display = settings.ethernet.boardType === 0 ? '' : 'none';
                get('divStaticIP').style.display = settings.ip.dhcp ? 'none' : '';
                get('spanCurrentIP').innerHTML = settings.ip.ip;
                this.refreshIpModeLabel(!!settings.ip.dhcp);
                const ipEdit = get('divDHCP');
                if (ipEdit && !ipEdit.contains(document.activeElement)) ipEdit.style.display = 'none';
                this.netInfo = Object.assign({}, this.netInfo, {
                    hostname: settings.hostname || '',
                    ip: (settings.ip && settings.ip.ip) || '',
                    gateway: (settings.ip && settings.ip.gateway) || '',
                    ssid: (settings.wifi && settings.wifi.ssid) || this.netInfo.ssid || ''
                });
                this.fillCopyFields();
                this.updateStatusBadge(settings);
                this.syncRadiosWithCheckbox();
                this.useEthernetClicked();
                this.hiddenSSIDClicked();
                this.refreshConnTip();
            }
        });
    }
    applyLoginContext(ctx) {
        if (!ctx) return;
        if (typeof ctx.connected === 'boolean') this.linkUp = ctx.connected;
        this.netInfo = Object.assign({}, this.netInfo, {
            hostname: ctx.hostname || this.netInfo.hostname || '',
            ip: window.location.hostname || this.netInfo.ip || ''
        });
        this.fillCopyFields();
        this.refreshConnTip();
        if (typeof ui !== 'undefined') ui.updateWelcomeChecklist();
    }
    updateStatusBadge(settings) {
        const connType = parseInt(settings && settings.connType, 10);
        let activeType = 'wifi';
        if (connType >= 2) {
            const boardType = (settings.ethernet && settings.ethernet.boardType !== undefined) ? parseInt(settings.ethernet.boardType, 10) : 0;
            const pwrPin = (settings.ethernet && settings.ethernet.PWRPin !== undefined) ? parseInt(settings.ethernet.PWRPin, 10) : -1;
            if (boardType === 1) activeType = 'lan';
            else if (pwrPin !== -1) activeType = 'poe';
            else activeType = 'lan';
        }
        this.connKind = activeType;
        if (settings) {
            this.netInfo = Object.assign({}, this.netInfo, {
                kind: activeType,
                hostname: settings.hostname || this.netInfo.hostname || '',
                ip: (settings.ip && settings.ip.ip) || this.netInfo.ip || '',
                gateway: (settings.ip && settings.ip.gateway) || this.netInfo.gateway || '',
                ssid: (settings.wifi && settings.wifi.ssid) || this.netInfo.ssid || ''
            });
            this.fillCopyFields();
        }
        this.renderConnIndicator(activeType);
        document.querySelectorAll('.opt-badge').forEach(opt => {
            opt.classList.toggle('active', opt.getAttribute('data-conn') === activeType);
        });
    }
    renderConnIndicator(kind, bars) {
        const el = get('divConnIndicator');
        if (!el) return;
        const k = kind || this.connKind || 'wifi';
        el.setAttribute('data-conn', k);
        const use = el.querySelector('.wired-ico use');
        if (use) use.setAttribute('href', k === 'poe' ? '#svg-poe' : '#svg-ethernet');
        if (typeof bars === 'number') {
            el.setAttribute('data-level', String(Math.max(0, Math.min(4, bars))));
            el.setAttribute('data-state', bars > 0 ? 'online' : 'offline');
        } else if (k === 'lan' || k === 'poe') {
            el.setAttribute('data-level', this.linkUp ? '4' : '0');
            el.setAttribute('data-state', this.linkUp ? 'online' : 'offline');
        }
        this.refreshConnTip();
    }
    setWifiBars(bars, online) {
        const el = get('divConnIndicator');
        if (!el) return;
        const level = online ? Math.max(1, Math.min(4, bars)) : 0;
        el.setAttribute('data-level', String(level));
        el.setAttribute('data-state', online ? 'online' : 'offline');
        this.refreshConnTip();
    }
    noteNetworkActivity(eventName) {
        if (this.connKind !== 'lan' && this.connKind !== 'poe') return;
        if (!this.linkUp) return;
        if (eventName === 'memStatus' || eventName === 'wifiStrength') return;
        const el = get('divConnIndicator');
        if (!el) return;
        el.classList.remove('is-rx');
        void el.offsetWidth;
        el.classList.add('is-rx');
    }
    fillCopyFields() {
        const ip = (this.netInfo && this.netInfo.ip) || '';
        const host = (this.netInfo && this.netInfo.hostname) || '';
        const connIp = get('spanConnIp');
        if (connIp) connIp.textContent = ip || '--';
        document.querySelectorAll('.spanEthIp').forEach(el => { el.textContent = ip || '--'; });
        document.querySelectorAll('.spanHostname').forEach(el => { el.textContent = host || '--'; });
    }
    refreshConnTip() {
        const tip = get('divConnTip');
        const el = get('divConnIndicator');
        if (!tip || !el) return;
        const info = this.netInfo || {};
        const kind = this.connKind || 'wifi';
        const addLine = (text, copy) => {
            if (!text) return;
            if (copy) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'copyable tip-copy';
                b.textContent = text;
                tip.appendChild(b);
            } else {
                const d = document.createElement('span');
                d.className = 'tip-line';
                d.textContent = text;
                tip.appendChild(d);
            }
        };
        tip.replaceChildren();
        if (kind === 'wifi') {
            const online = el.getAttribute('data-state') === 'online';
            addLine(online ? 'Wi‑Fi' : 'Wi‑Fi · not connected');
            if (info.ssid) addLine(info.ssid, true);
            if (online && typeof info.rssi === 'number' && info.rssi > -100) {
                addLine(`${info.rssi} dBm · ch ${info.channel >= 0 ? info.channel : '--'}`);
            }
        } else {
            const label = kind === 'poe' ? 'PoE' : 'LAN';
            addLine(this.linkUp ? `${label} · linked` : `${label} · no link`);
            if (this.linkUp && info.speed) {
                addLine(`${info.speed} Mbps${info.duplex ? ' full-duplex' : ''}`);
            }
        }
        if (info.hostname) addLine(info.hostname, true);
        if (info.ip) addLine(info.ip, true);
        else if (window.location.hostname) addLine(window.location.hostname, true);
        if (info.gateway && kind === 'wifi') addLine(`Gateway ${info.gateway}`);
        el.setAttribute('aria-label', (info.ssid || info.hostname || info.ip || 'Network'));
    }
    setConnectionType(isEthernet) {
        get('cbHardwired').checked = isEthernet;
        this.syncRadiosWithCheckbox();
        this.useEthernetClicked();
        get('cbHardwired').dispatchEvent(new Event('change'));
    }
    syncRadiosWithCheckbox() {
        const isEthernet = get('cbHardwired').checked;
        get('radConnEthernet').checked = isEthernet;
        get('radConnWifi').checked = !isEthernet;
    }
    useEthernetClicked() {
        let useEthernet = get('cbHardwired').checked;
        get('divWiFiMode').style.display = useEthernet ? 'none' : '';
        get('divEthernetMode').style.display = useEthernet ? '' : 'none';
        get('divTypeCardMode').style.display = useEthernet ? '' : 'none';
        get('divFallbackWireless').style.display = useEthernet ? '' : 'none';
        get('divRoaming').style.display = useEthernet ? 'none' : '';
        get('divHiddenSSID').style.display = useEthernet ? 'none' : '';
    }
    hiddenSSIDClicked() {
        let hidden = get('cbHiddenSSID').checked;
        if (hidden) get('cbRoaming').checked = false;
        get('cbRoaming').disabled = hidden;
    }
    async loadAPs() {
        const btnScan = get('btnScanAPs');
        const divAps = get('divAps');

        if (btnScan.classList.contains('disabled')) return;
        divAps.innerHTML = `<div class="no-wifi"><div class="wifiConnectScan"><div class="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div></div><div>${tr("CONNECTION_SCANNING")}</div></div>`;

        btnScan.classList.add('disabled');

        getJSON('/scanaps', (err, aps) => {
            btnScan.classList.remove('disabled');
            if (err || !aps || !aps.accessPoints) {
                this.displayAPs({ accessPoints: [] });
            } else {
                this.displayAPs(aps);
            }
        });
    }
    displayAPs(aps) {
        let nets = [];
        if (aps && aps.accessPoints) {
            for (let i = 0; i < aps.accessPoints.length; i++) {
                let ap = aps.accessPoints[i];
                let p = nets.find(elem => elem.name === ap.name);
                if (p) {
                    p.channel = p.strength > ap.strength ? p.channel : ap.channel;
                    p.macAddress = p.strength > ap.strength ? p.macAddress : ap.macAddress;
                    p.strength = Math.max(p.strength, ap.strength);
                } else {
                    nets.push(ap);
                }
            }
        }
        nets.sort((a, b) => b.strength - a.strength);

        let div = "";
        if (nets.length > 0) {
            div = `<div class="aps-title">${tr("CONNECTION_WIFI_AVAILABLE")}</div><hr class="aps-hr">`;
            for (let i = 0; i < nets.length; i++) {
                let ap = nets[i];
                div += `
                <div class="wifiSignal" onclick="wifi.selectSSID(this);" data-channel="${ap.channel}" data-encryption="${ap.encryption}" data-strength="${ap.strength}" data-mac="${ap.macAddress}"><span class="ssid">${ap.name}</span><span class="strength">${this.displaySignal(ap.strength)}</span>
                </div>`;
            }
        } else {
            div = `
            <div class="no-wifi"><div>${tr("ERR_NO_WIFI_FOUND")}</div><div class="button-container-row"><button id="btnRetryWifi" pop type="button" onclick="wifi.loadAPs();">${tr("BT_RETRY")}</button><button id="btnCancelWifi" pop line type="button" onclick="wifi.cancelScan();">${tr("BT_CANCEL_1")}</button>
            </div>`;
        }

        let divAps = get('divAps');
        divAps.setAttribute('data-lastloaded', new Date().getTime());
        divAps.innerHTML = div;
    }
    cancelScan() {
        const btnScan = get('btnScanAPs');
        if (btnScan) btnScan.classList.remove('disabled');

        const divAps = get('divAps');
        if (divAps) divAps.innerHTML = '';
        if (typeof ui !== 'undefined' && ui.unlock) ui.unlock();
    }
    selectSSID(el) {
        let obj = {
            name: el.querySelector('span.ssid').innerHTML,
            encryption: el.getAttribute('data-encryption'),
            strength: parseInt(el.getAttribute('data-strength'), 10),
            channel: parseInt(el.getAttribute('data-channel'), 10)
        };
        console.log(obj);
        document.getElementsByName('ssid')[0].value = obj.name;
    }
    calcWaveStrength(sig) {
        let wave = 0;
        if (sig > -90) wave = 0;
        if (sig > -80) wave = 1;
        if (sig > -70) wave = 2;
        if (sig > -60) wave = 3;
        return wave;
    }
    displaySignal(sig) {
        let level = this.calcWaveStrength(sig);
        if (level > 3) level = 3;

        const getPart = (idNum) => {
            const active = idNum <= level;
            return `<use href="#svg-wifi-${idNum}" fill="${active ? 'var(--accent-sucess)' : '#ccc'}" style="opacity:${active ? '1' : '0.3'}" />`;
        };

        return `
        <div class="signal">
        <svg>
        ${getPart(0)}
        ${getPart(1)}
        ${getPart(2)}
        ${getPart(3)}
        </svg>
        </div>`;
    }
    saveIPSettings() {
        let pnl = get('divDHCP');
        let obj = ui.fromElement(pnl).ip;
        console.log(obj);
        if (!obj.dhcp) {
            let fnValidateIP = (addr) => { return /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(addr); };
            if (typeof obj.ip !== 'string' || obj.ip.length === 0 || obj.ip === '0.0.0.0') {
                ui.errorMessage(tr('ERR_STATIC_IP_REQUIRED'));
                return;
            }
            else if (!fnValidateIP(obj.ip)) {
                ui.errorMessage(tr('ERR_STATIC_IP_INVALID'));
                return;
            }
            if (typeof obj.subnet !== 'string' || obj.subnet.length === 0 || obj.subnet === '0.0.0.0') {
                ui.errorMessage(tr('ERR_NETMASK_REQUIRED'));
                return;
            }
            else if (!fnValidateIP(obj.subnet)) {
                ui.errorMessage(tr('ERR_NETMASK_INVALID'));
                return;
            }
            if (typeof obj.gateway !== 'string' || obj.gateway.length === 0 || obj.gateway === '0.0.0.0') {
                ui.errorMessage(tr('ERR_GATEWAY_REQUIRED'));
                return;
            }
            else if (!fnValidateIP(obj.gateway)) {
                ui.errorMessage(tr('ERR_GATEWAY_INVALID'));
                return;
            }
            if (obj.dns1.length !== 0 && !fnValidateIP(obj.dns1)) {
                ui.errorMessage(tr('ERR_DNS1_INVALID'));
                return;
            }
            if (obj.dns2.length !== 0 && !fnValidateIP(obj.dns2)) {
                ui.errorMessage(tr('ERR_DNS2_INVALID'));
                return;
            }
        }
        putJSONSync('/setIP', obj, (err, response) => {
            if (err) {
                ui.serviceError(err);
            } else {
                ui.successMessage(tr('MSG_SAVE_SUCCESS'));
                this.refreshIpModeLabel(!!obj.dhcp);
                console.log(response);
            }
        });
    }
    saveNetwork() {
        let pnl = get('divNetAdapter'), obj = ui.fromElement(pnl);
        // IP fields live on the same Network page; save them via saveIPSettings only.
        if (obj && Object.prototype.hasOwnProperty.call(obj, 'ip')) delete obj.ip;
        const eth = obj.ethernet;
        // Si la valeur extraite est NaN, vide ou "None", on la remet proprement à -1
        if (isNaN(eth.PWRPin) || eth.PWRPin === 'None' || eth.PWRPin === '') {
            eth.PWRPin = -1;
        }
        obj.connType = eth.hardwired ? (eth.wirelessFallback ? 3 : 2) : 1;

        if (obj.connType >= 2) {
            const [board, phy, clk] = [
                this.ethBoardTypes.find(e => eth.boardType === e.val),
                this.ethPhyTypes.find(e => eth.phyType === e.val),
                this.ethClockModes.find(e => eth.CLKMode === e.val)
            ];

            let boardLabel = board ? board.label : tr("MANUAL_SETTINGS");
            let boardVal = board ? board.val : 0;
            let phyLabel = phy ? phy.label : '---';
            let phyVal = phy ? phy.val : 0;
            let clkLabel = clk ? clk.label : '---';
            let clkVal = clk ? clk.val : 0;

            let div = document.createElement('div');
            div.className = 'inst-overlay';
            div.innerHTML = `
            <div class="instructions-content">
            <div class="overlay-scroll-content">
            ${overlayHeader('ETH_SETTINGS_TITLE', 'ETH_SETTINGS_DESC', 'svg-ethernet')}
            <div class="unibloc"><p>${tr("ETH_SETTINGS_WARNING_DESC_1")}</p></div>
            <div class="blocEthBoardSettings">
            <div>
            <div class="eth-setting-line"><label>${tr("ETH_SETTINGS_BOARD_TYPE")}</label><span>${boardLabel} [${boardVal}]</span></div>
            <div class="eth-setting-line"><label>${tr("ETH_SETTINGS_PHY_TYPE")}</label><span>${phyLabel} [${phyVal}]</span></div>
            <div class="eth-setting-line"><label>${tr("ETH_SETTINGS_PHY_ADDRESS")}</label><span>${eth.phyAddress ?? 0}</span></div>
            <div class="eth-setting-line"><label>${tr("ETH_SETTINGS_CLOCK_MODE")}</label><span>${clkLabel} [${clkVal}]</span></div>
            <div class="eth-setting-line"><label>${tr("ETH_SETTINGS_POWER_PIN")}</label><span>${(eth.PWRPin === undefined || eth.PWRPin === -1) ? tr("NONE") : eth.PWRPin}</span></div>
            <div class="eth-setting-line"><label>${tr("ETH_SETTINGS_MDC_PIN")}</label><span>${eth.MDCPin ?? 0}</span></div>
            <div class="eth-setting-line"><label>${tr("ETH_SETTINGS_MDIO_PIN")}</label><span>${eth.MDIOPin ?? 0}</span></div>
            </div>
            </div>
            <div class="error">
            <label class="safety-checkbox-container">
            <div><input type="checkbox" id="chkConfirmEth"><span class="custom-checkbox"></span></div>
            <div><b>${tr('MSG_DANGER')}</b> <span>${tr("ETH_SETTINGS_WARNING_DESC_2")}</span></div>
            </label>
            </div>
            </div>
            <div class="hrDivFooter"></div>
            <div class="button-container-overlay">
            <button id="btnCancel" line type="button">${tr("BT_CANCEL_1")}</button>
            <button id="btnSaveEthernet" style="background:#ccc;cursor:not-allowed" type="button" disabled>${tr("BT_SAVE")}</button>
            </div>
            </div>
            </div>`;

            shOverlay(div);

            const chk = div.querySelector('#chkConfirmEth'), btn = div.querySelector('#btnSaveEthernet');
            chk.onchange = () => {
                const ok = chk.checked;
                btn.disabled = !ok;
                btn.style.background = ok ? "var(--txtwarning-color)" : "#ccc";
                btn.style.cursor = ok ? "pointer" : "not-allowed";
            };
            btn.onclick = () => { this.sendNetworkSettings(obj); closeOverlay(div); };
            div.querySelector('#btnCancel').onclick = () => closeOverlay(div);
        } else {
            this.sendNetworkSettings(obj);
        }
    }
    sendNetworkSettings(obj) {
        putJSONSync('/setNetwork', obj, (err, response) => {
            if (err) {
                ui.serviceError(err);
            } else {
                ui.successMessage(tr('MSG_SAVE_SUCCESS'));
                console.log("Network settings updated:", response);
            }
        });
    }
    connectWiFi() {
        if (get('btnConnectWiFi').classList.contains('disabled')) return;
        get('btnConnectWiFi').classList.add('disabled');
        let obj = {
            ssid: document.getElementsByName('ssid')[0].value,
            passphrase: document.getElementsByName('passphrase')[0].value
        };
        if (obj.ssid.length > 64) {
            ui.errorMessage(tr('ERR_WIFI_SSID_INVALID')).querySelector('.sub-message').innerHTML = tr('ERR_WIFI_SSID_MAX_LENGTH_64');
            return;
        }
        if (obj.passphrase.length > 64) {
            ui.errorMessage(tr('ERR_WIFI_PASSPHRASE_INVALID')).querySelector('.sub-message').innerHTML = tr('ERR_WIFI_PASSPHRASE_MAX_LENGTH_64');
            return;
        }
        let overlay = ui.waitMessage(get('divNetAdapter'));
        putJSON('/connectwifi', obj, (err, response) => {
            overlay.remove();
            get('btnConnectWiFi').classList.remove('disabled');
            console.log(response);
        });
    }
    procWifiStrength(strength) {
        if (!strength) return;

        const ssid = strength.ssid || strength.name;
        const sVal = parseInt(strength.strength, 10);
        const elSSID = get('spanNetworkSSID');
        const elChan = get('spanNetworkChannel');
        const elStrength = get('spanNetworkStrength');

        if (elSSID) elSSID.innerHTML = !ssid || ssid === '' ? '-------------' : ssid;
        if (elChan) elChan.innerHTML = isNaN(strength.channel) || strength.channel < 0 ? '--' : strength.channel;
        if (elStrength) elStrength.innerHTML = isNaN(sVal) || sVal <= -100 ? '----' : sVal;

        let level = (isNaN(sVal) || sVal >= 0 || sVal <= -100) ? -1 : this.calcWaveStrength(sVal);
        if (level >= 3) level = 3;

        for (let i = 0; i <= 3; i++) {
            const part = get('wifi_' + i);
            if (part) {
                if (i <= level) part.classList.add('active');
                else part.classList.remove('active');
            }
        }

        const online = !!(ssid && ssid !== '' && level >= 0);
        this.linkUp = online || ((this.connKind === 'lan' || this.connKind === 'poe') && this.linkUp);
        if (typeof ui !== 'undefined') ui.updateWelcomeChecklist();
        this.netInfo = Object.assign({}, this.netInfo, {
            ssid: ssid || this.netInfo.ssid || '',
            rssi: isNaN(sVal) ? -100 : sVal,
            channel: isNaN(strength.channel) ? -1 : strength.channel
        });
        if ((this.connKind || 'wifi') === 'wifi') {
            this.setWifiBars(online ? (level + 1) : 0, online);
        }
    }
    procEthernet(ethernet) {
        console.log(ethernet);
        const spanStatus = get('spanEthernetStatus');
        const divStatus = get('divEthernetStatus');
        const divWifi = get('divWiFiStrength');
        const spanSpeed = get('spanEthernetSpeed');

        if (divStatus) divStatus.style.display = ethernet.connected ? '' : 'none';
        if (divWifi) divWifi.style.display = ethernet.connected ? 'none' : '';
        if (spanStatus) {
            spanStatus.innerHTML = ethernet.connected ? 'Connected' : 'Disconnected';
            spanStatus.style.color = ethernet.connected ? 'var(--accent-sucess)' : '';
        }
        if (spanSpeed) spanSpeed.innerHTML = !ethernet.connected ? '--------' : `${ethernet.speed} Mbps ${ethernet.fullduplex ? 'Full-duplex' : 'Half-duplex'}`;

        this.linkUp = !!ethernet.connected;
        if (typeof ui !== 'undefined') ui.updateWelcomeChecklist();
        this.netInfo = Object.assign({}, this.netInfo, {
            speed: parseInt(ethernet.speed, 10) || 0,
            duplex: !!ethernet.fullduplex
        });
        if ((this.connKind || '') === 'lan' || (this.connKind || '') === 'poe') {
            this.renderConnIndicator(this.connKind);
            if (ethernet.connected) this.noteNetworkActivity('ethernet');
        }
    }
}
var wifi = new Wifi();
class Somfy {
    initialized = false;
    frames = [];
    txFrames = [];
    scenes = [];
    schedules = [];
    isScanClosing = false;
    scanObserver = null;
    shadeTypes = [
        { type: 0, name: 'Roller Shade', ico: 'svg-window-shade', lift: true, sun: true, fcmd: true, fpos: true },
        { type: 1, name: 'Blind', ico: 'svg-window-blind', lift: true, tilt: true, sun: true, fcmd: true, fpos: true },
        { type: 2, name: 'Drapery (left)', ico: 'svg-ldrapery', lift: true, sun: true, fcmd: true, fpos: true },
        { type: 3, name: 'Awning', ico: 'svg-awning', lift: true, sun: true, fcmd: true, fpos: true },
        { type: 4, name: 'Shutter', ico: 'svg-shutter', lift: true, sun: true, fcmd: true, fpos: true },
        { type: 5, name: 'Garage (1-button)', ico: 'svg-garage', lift: true, light: true, fpos: true },
        { type: 6, name: 'Garage (3-button)', ico: 'svg-garage', lift: true, light: true, fcmd: true, fpos: true },
        { type: 7, name: 'Drapery (right)', ico: 'svg-rdrapery', lift: true, sun: true, fcmd: true, fpos: true },
        { type: 8, name: 'Drapery (center)', ico: 'svg-cdrapery', lift: true, sun: true, fcmd: true, fpos: true },
        { type: 9, name: 'Dry Contact (1-button)', ico: 'svg-contactBulb', fpos: true },
        { type: 10, name: 'Dry Contact (2-button)', ico: 'svg-contactBulb', fcmd: true, fpos: true },
        { type: 11, name: 'Gate (left)', ico: 'svg-lgate', lift: true, fcmd: true, fpos: true },
        { type: 12, name: 'Gate (center)', ico: 'svg-cgate', lift: true, fcmd: true, fpos: true },
        { type: 13, name: 'Gate (right)', ico: 'svg-rgate', lift: true, fcmd: true, fpos: true },
        { type: 14, name: 'Gate (1-button left)', ico: 'svg-lgate', lift: true, fcmd: true, fpos: true },
        { type: 15, name: 'Gate (1-button center)', ico: 'svg-cgate', lift: true, fcmd: true, fpos: true },
        { type: 16, name: 'Gate (1-button right)', ico: 'svg-rgate', lift: true, fcmd: true, fpos: true },
    ];
    radioBoardTypes = [
        { val: 0, label: 'DEFAULT', showGPIO: false },
        { val: 1, label: 'ESP32-D1 mini', showGPIO: false, chips: ['esp32'], pins: { SCKPin: 18, CSNPin: 5, MOSIPin: 23, MISOPin: 19, TXPin: 21, RXPin: 22 } },
        { val: 2, label: 'WT32-ETH01', showGPIO: false, chips: ['esp32'], pins: { SCKPin: 14, CSNPin: 12, MOSIPin: 15, MISOPin: 4, TXPin: 2, RXPin: 35 } },
        { val: 3, label: 'Olimex ESP32-PoE/EVB', showGPIO: false, chips: ['esp32'], pins: { SCKPin: 14, CSNPin: 13, MOSIPin: 15, MISOPin: 16, TXPin: 4, RXPin: 36 } },
        { val: 4, label: 'LilyGO T-Internet POE', showGPIO: false, chips: ['esp32'], pins: { SCKPin: 14, CSNPin: 12, MOSIPin: 15, MISOPin: 16, TXPin: 4, RXPin: 35 } },
        { val: 5, label: 'wESP POE', showGPIO: false, chips: ['esp32'], pins: { SCKPin: 18, CSNPin: 5, MOSIPin: 13, MISOPin: 32, TXPin: 4, RXPin: 39 } },
        { val: 6, label: 'ESP-PoE-32', showGPIO: false, chips: ['esp32'], pins: { SCKPin: 14, CSNPin: 5, MOSIPin: 13, MISOPin: 32, TXPin: 4, RXPin: 35 } },
        { val: 7, label: 'ESP32s3 Mini', showGPIO: false, chips: ['s3'], pins: { SCKPin: 7, CSNPin: 6, MOSIPin: 9, MISOPin: 8, TXPin: 3, RXPin: 4 } },
        { val: 8, label: 'XIAO-ESP32-C3', showGPIO: false, chips: ['c3'], pins: { SCKPin: 8, CSNPin: 6, MOSIPin: 10, MISOPin: 9, TXPin: 3, RXPin: 4 } },
        { val: 255, label: 'MANUAL_SETTINGS', showGPIO: true }
    ];

    init() {
        if (this.initialized) return;
        this.initialized = true;
        this.ensureHomeCmdDelegation();
    }
    ensureHomeCmdDelegation() {
        if (this._homeCmdDelegated) return;
        this._homeCmdDelegated = true;
        const shadeRoot = get('divShadeControls');
        const groupRoot = get('divGroupControls');
        if (shadeRoot) {
            shadeRoot.addEventListener('mouseup', (e) => this._onShadeCmdMouseUp(e), true);
            shadeRoot.addEventListener('mousedown', (e) => this._onShadeCmdMouseDown(e), true);
            shadeRoot.addEventListener('touchstart', (e) => this._onShadeCmdTouchStart(e), { capture: true, passive: true });
            shadeRoot.addEventListener('click', (e) => this._onShadeMoreClick(e), true);
        }
        if (groupRoot) {
            groupRoot.addEventListener('click', (e) => this._onGroupCmdClick(e), true);
        }
    }
    _shadeCmdBtn(e) {
        const btn = e.target.closest('.cmd-button');
        if (!btn || !btn.closest('#divShadeControls')) return null;
        return btn;
    }
    _onShadeCmdMouseUp(event) {
        const btn = this._shadeCmdBtn(event);
        if (!btn) return;
        let cmd = btn.getAttribute('data-cmd');
        let shadeId = parseInt(btn.getAttribute('data-shadeid'), 10);
        if (this.btnTimer) {
            clearTimeout(this.btnTimer);
            this.btnTimer = null;
            if (new Date().getTime() - this.btnDown > 2000) event.preventDefault();
            else this.sendCommand(shadeId, cmd);
        }
        else if (cmd === 'light') {
            btn.setAttribute('data-on', !makeBool(btn.getAttribute('data-on')));
        }
        else if (cmd === 'sunflag') {
            if (makeBool(btn.getAttribute('data-on')))
                this.sendCommand(shadeId, 'flag');
            else
                this.sendCommand(shadeId, 'sunflag');
        }
        else this.sendCommand(shadeId, cmd);
    }
    _onShadeCmdMouseDown(event) {
        const btn = this._shadeCmdBtn(event);
        if (!btn) return;
        if (this.btnTimer) {
            clearTimeout(this.btnTimer);
            this.btnTimer = null;
        }
        let elShade = btn.closest('div.somfyShadeCtl');
        let cmd = btn.getAttribute('data-cmd');
        let shadeId = parseInt(btn.getAttribute('data-shadeid'), 10);
        this.btnDown = new Date().getTime();
        if (cmd === 'my') {
            if (parseInt(elShade.getAttribute('data-direction'), 10) === 0) {
                this.btnTimer = setTimeout(() => {
                    this.openSetMyPosition(shadeId);
                }, 2000);
            }
        }
        else if (cmd === 'light') return;
        else if (cmd === 'sunflag') return;
        else if (makeBool(elShade.getAttribute('data-tilt'))) {
            this.btnTimer = setTimeout(() => {
                this.sendTiltCommand(shadeId, cmd);
            }, 2000);
        }
    }
    _onShadeCmdTouchStart(event) {
        const btn = this._shadeCmdBtn(event);
        if (!btn) return;
        if (this.btnTimer) {
            clearTimeout(this.btnTimer);
            this.btnTimer = null;
        }
        let elShade = btn.closest('div.somfyShadeCtl');
        let cmd = btn.getAttribute('data-cmd');
        let shadeId = parseInt(btn.getAttribute('data-shadeid'), 10);
        this.btnDown = new Date().getTime();
        if (parseInt(elShade.getAttribute('data-direction'), 10) === 0) {
            if (cmd === 'my') {
                this.btnTimer = setTimeout(() => {
                    this.openSetMyPosition(shadeId);
                }, 2000);
            }
            else if (makeBool(elShade.getAttribute('data-tilt'))) {
                this.btnTimer = setTimeout(() => {
                    this.sendTiltCommand(shadeId, cmd);
                }, 2000);
            }
        }
    }
    _onShadeMoreClick(event) {
        const more = event.target.closest('.shadectl-more');
        if (!more || !more.closest('#divShadeControls')) return;
        event.preventDefault();
        event.stopPropagation();
        const shadeId = parseInt(more.getAttribute('data-shadeid'), 10);
        this.openShadeOverflow(shadeId, more);
    }
    _onGroupCmdClick(event) {
        const btn = event.target.closest('.cmd-button');
        if (!btn || !btn.closest('#divGroupControls')) return;
        let groupId = parseInt(btn.getAttribute('data-groupid'), 10);
        let cmd = btn.getAttribute('data-cmd');
        if (cmd === 'sunflag') {
            if (makeBool(btn.getAttribute('data-on')))
                this.sendGroupCommand(groupId, 'flag');
            else
                this.sendGroupCommand(groupId, 'sunflag');
        }
        else
            this.sendGroupCommand(groupId, cmd);
    }
    closeShadeOverflow() {
        const menu = get('divShadeOverflow');
        if (menu) menu.remove();
        if (this._overflowCloser) {
            document.removeEventListener('click', this._overflowCloser, true);
            this._overflowCloser = null;
        }
    }
    openShadeOverflow(shadeId, anchor) {
        this.closeShadeOverflow();
        const shade = (this.shades || []).find(s => Number(s.shadeId) === Number(shadeId));
        const pinned = this.getFavoriteIds().includes(Number(shadeId));
        const myLabel = shade && shade.myPos >= 0
            ? ((tr('HOME_QA_MY') || 'My') + ' ' + this.formatPosLabel(shade.myPos))
            : (tr('SHADE_FAVORITE_POSITION') || 'Favorite');
        const menu = document.createElement('div');
        menu.id = 'divShadeOverflow';
        menu.className = 'home-shade-overflow';
        menu.innerHTML =
            `<button type="button" data-act="cfg"><svg><use href="#svg-cfg"></use></svg><span>${tr('SHADE_CONFIGURE') || 'Configure'}</span></button>` +
            `<button type="button" data-act="pin"><svg><use href="#svg-favori"></use></svg><span>${pinned ? (tr('HOME_UNPIN_FAVORITE') || 'Unpin') : (tr('HOME_PIN_FAVORITE') || 'Pin to Home')}</span></button>` +
            `<button type="button" data-act="my"><svg><use href="#svg-my"></use></svg><span>${myLabel}</span></button>`;
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        const mw = menu.offsetWidth || 168;
        const mh = menu.offsetHeight || 140;
        let left = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw));
        let top = r.bottom + 6;
        if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const act = btn.getAttribute('data-act');
            this.closeShadeOverflow();
            if (act === 'cfg') this.configureShade(shadeId);
            else if (act === 'pin') this.toggleFavorite(shadeId);
            else if (act === 'my') this.openSetMyPosition(shadeId);
        });
        this._overflowCloser = (e) => {
            if (menu.contains(e.target) || (anchor && anchor.contains(e.target))) return;
            this.closeShadeOverflow();
        };
        setTimeout(() => document.addEventListener('click', this._overflowCloser, true), 0);
    }
    toggleHomeSearch(open) {
        const wrap = get('divHomeSearchWrap');
        const fld = get('fldHomeSearch');
        if (!wrap) return;
        if (open) {
            wrap.classList.add('is-expanded');
            if (fld) setTimeout(() => fld.focus(), 0);
        } else {
            wrap.classList.remove('is-expanded');
        }
    }
    onHomeSearchBlur() {
        const fld = get('fldHomeSearch');
        if (fld && String(fld.value || '').trim()) return;
        this.toggleHomeSearch(false);
    }
    // Drapery/gate SVGs open as --shade-position rises; roller/shutter SVGs close as it rises.
    // API scale matches HA: 100% = open · 0% = closed (flipPosition only remaps numbers).
    _iconOpensAtHighPosition(shadeType) {
        return [2, 7, 8, 11, 12, 13, 14, 15, 16].includes(parseInt(shadeType, 10));
    }
    formatPosLabel(apiPos) {
        const p = parseInt(apiPos, 10);
        if (isNaN(p)) return '—';
        if (p >= 100) return tr('POS_OPEN') || 'Open';
        if (p <= 0) return tr('POS_CLOSED') || 'Closed';
        return `${p}%`;
    }
    canSetPosition(shadeType) {
        return ![5, 9, 10, 14, 15, 16].includes(parseInt(shadeType, 10));
    }
    dismissPositioners(animate = true) {
        document.querySelectorAll('.shade-positioner').forEach(el => {
            if (!animate) { el.remove(); return; }
            el.classList.add('popup-slide-out');
            setTimeout(() => el.remove(), 280);
        });
    }
    // Map API position (100%=open · 0%=closed) onto SVG --shade-position.
    // Do not re-apply flipPosition — API position is already transformed server-side.
    iconVisualPosition(apiPos, _flipPosition, shadeType) {
        let visual = parseInt(apiPos, 10);
        if (isNaN(visual)) visual = 0;
        // Roller/blind SVGs use high CSS var = closed; drapery uses high = open.
        if (!this._iconOpensAtHighPosition(shadeType)) visual = 100 - visual;
        return visual;
    }
    applyShadeIconPosition(el, apiPos, flipPosition, shadeType) {
        if (!el) return;
        const p = this.iconVisualPosition(apiPos, flipPosition, shadeType);
        el.style.setProperty('--shade-position', p);
        el.style.setProperty('--fpos', `${apiPos}%`);
    }
    initPins() {
        document
        .getElementById('selRadioBoardType')
        .addEventListener('change', e => this.onRadioBoardTypeChanged(e.target));

        const sel = get('selRadioBoardType');

        sel.addEventListener('change', e => this.onRadioBoardTypeChanged(e.target));

        this.loadPins('inout', get('selTransSCKPin'));
        this.loadPins('inout', get('selTransCSNPin'));
        this.loadPins('inout', get('selTransMOSIPin'));
        this.loadPins('input', get('selTransMISOPin'));
        this.loadPins('out', get('selTransTXPin'));
        this.loadPins('input', get('selTransRXPin'));

        ui.toElement(get('divTransceiverSettings'), {
            transceiver: { config: { proto: 0, radioBoardType: 0, SCKPin: 18, CSNPin: 5, MOSIPin: 23, MISOPin: 19, TXPin: 13, RXPin: 12, frequency: 433.42, rxBandwidth: 97.96, type: 56, deviation: 11.43, txPower: 10, enabled: false } }
        });

        this.loadPins('out', get('selShadeGPIOUp'));
        this.loadPins('out', get('selShadeGPIODown'));
        this.loadPins('out', get('selShadeGPIOMy'));
        this.loadRadioBoardTypes(get('selRadioBoardType'));
        this.loadRadioBoardTypes(sel);
        this.onRadioBoardTypeChanged(sel);
    }
    loadRadioBoardTypes(sel) {
        while (sel.firstChild) sel.removeChild(sel.firstChild);

        let rawCm = get('divContainer').getAttribute('data-chipmodel') || "";
        let cm = rawCm.toLowerCase().trim();

        if (cm.includes("s3")) cm = "s3";
        else if (cm.includes("c3")) cm = "c3";
        else if (cm.includes("s2")) cm = "s2";
        else cm = "esp32";

        this.radioBoardTypes.forEach(t => {
            if (t.chips && !t.chips.includes(cm)) {
                return;
            }
            let labelKey = t.label;
            if (t.val === 0 && labelKey === 'DEFAULT') {
                labelKey = `BOARD_DEFAULT_${cm.toUpperCase()}`;
            }

            const labelText = tr(labelKey);
            sel.options.add(new Option(labelText, t.val));
        });
    }
    onRadioBoardTypeChanged(sel, isInit = false) {
        const val = parseInt(sel.value, 10),
        cm = (get('divContainer').getAttribute('data-chipmodel') || "").toLowerCase(),
        divS = get('divGPIOSummary'),
        divG = get('divShowGpio'),
        pk = ['SCKPin', 'CSNPin', 'MOSIPin', 'MISOPin', 'TXPin', 'RXPin'],
        isM = (val === 255),
        board = this.radioBoardTypes.find(t => t.val === val);

        let def = { SCKPin: 18, CSNPin: 5, MOSIPin: 23, MISOPin: 19, TXPin: 13, RXPin: 12 };
        if (cm === "s3") def = { SCKPin: 12, CSNPin: 10, MOSIPin: 11, MISOPin: 13, TXPin: 15, RXPin: 14 };
        else if (cm === "s2") def = { SCKPin: 36, CSNPin: 34, MOSIPin: 35, MISOPin: 37, TXPin: 15, RXPin: 14 };
        else if (cm === "c3") def = { SCKPin: 15, CSNPin: 14, MOSIPin: 16, MISOPin: 17, TXPin: 13, RXPin: 12 };

        const target = val === 0 ? def : (board?.pins || null);

        if (target) {
            const labels = ['SCLK:', 'CSN:', 'MOSI:', 'MISO:', 'TX:', 'RX:'];
            let html = `<div class="gpioRadio-container"><div class="help-container" onclick="toggleTooltip(this)"><svg class="help-svg"><use href=#icon-question></use></svg><div class="tooltip-text"><b>${tr('RADIO_TOOLTIP_GPIO_0')}</b><br><br>${tr('RADIO_TOOLTIP_GPIO_1')}<br>${tr('RADIO_TOOLTIP_GPIO_2')}<br><br><i>${tr('RADIO_TOOLTIP_GPIO_3')}</i><br><br></div></div>`;

            pk.forEach((k, i) => {
                const v = target[k], selP = get(`selTrans${k}`), inpP = get(`inputTrans${k}`);
                if (selP) {
                    if (![...selP.options].some(o => parseInt(o.value, 10) === v)) {
                        selP.options.add(new Option(`GPIO-${v < 10 ? '0' + v : v}`, v));
                    }
                    selP.value = v;
                }
                if (inpP) inpP.value = v;
                html += `<div class="gpioRadio-item"><span class="gpioRadio-label">${labels[i]}</span><span class="gpioRadio-val">GPIO${v}</span></div>${i < 5 ? `<div class="gpioRadio-sep${i === 2 ? ' gpioRadioSep' : ''}">|</div>` : ''}`;
            });
            divS.innerHTML = html + `</div>`;
        }

        pk.forEach(k => {
            const selP = get(`selTrans${k}`), inpP = get(`inputTrans${k}`);
            if (selP) selP.style.display = target ? 'inline-block' : 'none';
            if (inpP) {
                if (isM) inpP.value = (isInit && parseInt(selP?.value || inpP.value, 10)) || def[k];
                inpP.style.display = isM ? 'inline-block' : 'none';
            }
        });

        get('divManualSafety').style.display = isM ? 'block' : 'none';
        divS.style.display = target ? 'block' : 'none';
        divG.style.display = target ? 'none' : 'inline-block';
    }
    setFwLibs(libs) {
        const el = get('spanFwLibs');
        if (!el) return;
        if (!libs) {
            el.textContent = 'CC1101 · ArduinoJson · AsyncWebServer';
            return;
        }
        const parts = [];
        if (libs.cc1101) parts.push(`CC1101 ${libs.cc1101}`);
        if (libs.arduinojson) parts.push(`ArduinoJson ${libs.arduinojson}`);
        if (libs.asyncwebserver) parts.push(`AsyncWebServer ${libs.asyncwebserver}`);
        if (libs.asynctcp) parts.push(`AsyncTCP ${libs.asynctcp}`);
        if (libs.websockets) parts.push(`WebSockets ${libs.websockets}`);
        if (libs.pubsub) parts.push(`PubSubClient ${libs.pubsub}`);
        if (libs.platform) parts.push(libs.platform);
        if (parts.length) el.textContent = parts.join(' · ');
    }
    async loadSomfy() {
        //console.trace("Appel à loadSomfy");
        getJSONSync('/controller', (err, somfy) => {
            if (err) {
                console.log(err);
                ui.serviceError(err);
            } else {
                this.maxRooms = somfy.maxRooms;
                this.maxShades = somfy.maxShades;
                this.maxGroups = somfy.maxGroups;
                this.maxGroupsUsable = Math.max(0, (somfy.maxGroups || 16) - 2);
                get('spanMaxRooms').innerText = somfy.maxRooms;
                get('spanMaxShades').innerText = somfy.maxShades;
                get('spanMaxGroups').innerText = this.maxGroupsUsable;
                this.maxFixedCodes = somfy.maxFixedCodes || 8;
                if (get('spanMaxFixedCodes')) get('spanMaxFixedCodes').innerText = `(${tr('FC_MAX')} ${this.maxFixedCodes})`;
                this.setFwLibs(somfy.libs);
                this.transceiver = somfy.transceiver || this.transceiver;

                ui.toElement(get('divTransceiverSettings'), somfy);

                const selBoard = get('selRadioBoardType');
                if (selBoard) {
                    this.loadRadioBoardTypes(selBoard);
                }

                if (somfy.transceiver && somfy.transceiver.config) {
                    if (selBoard) selBoard.value = somfy.transceiver.config.radioBoardType || 0;
                    this.onRadioBoardTypeChanged(selBoard, true);
                }

                const cbRadio = get('cbEnableRadio');
                const cfg = somfy.transceiver && somfy.transceiver.config;
                if (cbRadio && cfg) cbRadio.checked = makeBool(cfg.enabled);
                this._radioInit = !!(cfg && cfg.radioInit);
                this._radioEnabledSaved = !!(cbRadio && cbRadio.checked);
                const syncRadioChrome = () => {
                    this.syncRadioEnableUi(cbRadio, this._radioInit, this._radioEnabledSaved);
                };
                if (cbRadio && !cbRadio.dataset.radioChromeBound) {
                    cbRadio.dataset.radioChromeBound = '1';
                    cbRadio.addEventListener('change', syncRadioChrome);
                }
                syncRadioChrome();

                this.setRoomsList(somfy.rooms);
                this.setShadesList(somfy.shades);
                this.setGroupsList(somfy.groups);
                this.setRepeaterList(somfy.repeaters);
                this.setFixedCodesList(somfy.fixedCodes || []);
                this.loadAutomation();
                if (typeof ui !== 'undefined') ui.updateWelcomeChecklist();
                if (typeof somfy.version !== 'undefined') {
                    firmware.procFwStatus(somfy.version);
                }
            }
        });
    }
    stepGpio(pinKey, direction) {
        const newValue = stepDeviceGpio(pinKey, direction, 'Trans', 'selRadioBoardType', val => val === 255, this.pinMaps);
        if (newValue === undefined) return;

        const targetLabel = pinKey.replace('Pin', '').toUpperCase() + ':';
        document.querySelectorAll('#divGPIOSummary .gpioRadio-label').forEach(lbl => {
            const text = lbl.textContent.trim();
            if (text === targetLabel || (targetLabel === 'SCK:' && text === 'SCLK:')) {
                const valSpan = lbl.nextElementSibling;
                if (valSpan && valSpan.classList.contains('gpioRadio-val')) valSpan.textContent = `GPIO${newValue}`;
            }
        });
    }
    syncRadioEnableUi(cb, radioInit, savedEnabled) {
        const on = !!(cb && cb.checked);
        const initOk = !!radioInit;
        const sw = cb && cb.closest('.switch');
        if (sw) sw.classList.toggle('is-on', on);
        const row = get('divRadioEnableColor');
        if (row) row.classList.toggle('radioOn', on && initOk);
        const radioTab = document.querySelector('.tab-container span[data-grpid="divRadioSettings"]');
        const sideNote = get('barsideRadioDisable');
        if (radioTab) radioTab.classList.toggle('radio-error', !initOk);
        if (sideNote) sideNote.style.display = initOk ? 'none' : 'inline';
        const txtStatus = get('divRadioEnableStatus');
        if (!txtStatus) return;
        if (typeof savedEnabled === 'boolean' && on !== savedEnabled) {
            txtStatus.textContent = tr('RADIO_SAVE_REQUIRED');
        } else if (on && !initOk) {
            txtStatus.textContent = tr('RADIO_INIT_FAILED');
        } else {
            txtStatus.textContent = tr(on ? 'RADIO_ENABLED' : 'RADIO_DISABLED');
        }
    }
    saveRadio() {
        let valid = true;
        const d = get('divTransceiverSettings'),
        t = ui.fromElement(d).transceiver,
        pk = ['SCKPin', 'CSNPin', 'MOSIPin', 'MISOPin', 'TXPin', 'RXPin'],
        bv = parseInt(get('selRadioBoardType').value, 10),
        isM = (bv === 255);

        if (!t.config) t.config = {};
        t.config.radioBoardType = bv;

        if (isM && !get('cbManualSafety')?.checked) {
            return ui.errorMessage(d, tr('ERR_RADIO_SAFETY_REQUIRED'));
        }

        pk.forEach(k => {
            const el = get((isM ? 'inputTrans' : 'selTrans') + k);
            if (el) t.config[k] = parseInt(el.value, 10);
        });

            if (!t.config.type || t.config.type === 'none') {
                ui.errorMessage(d, tr('ERR_RADIO_TYPE_REQUIRED'));
                valid = false;
            }

            if (valid) {
                const cm = (get('divContainer').getAttribute('data-chipmodel') || "").toLowerCase(),
                pm = this.pinMaps.find(x => x.name === cm) || { maxPins: 39 };

                try {
                    for (const k of pk) {
                        const v = t.config[k];
                        if (v === undefined || isNaN(v)) {
                            ui.errorMessage(d, tr('ERR_RADIO_PINS_REQUIRED'));
                            valid = false; break;
                        }
                        if (v < 0 || v > pm.maxPins) {
                            ui.errorMessage(d, tr('ERR_GPIO_NOT_EXIST').replace('{pin}', v).replace('{maxPins}', pm.maxPins));
                            valid = false; break;
                        }
                        for (let s in t.config) {
                            if (s.endsWith('Pin') && s !== k && t.config[s] === v) {
                                if ((k === 'TXPin' && s === 'RXPin') || (k === 'RXPin' && s === 'TXPin')) continue;
                                ui.errorMessage(d, tr('ERR_GPIO_PIN_DUPLICATED').replace('%1', k.replace('Pin', '')).replace('%2', s.replace('Pin', '')));
                                valid = false; break;
                            }
                        }
                        if (!valid) break;
                    }
                } catch (err) {
                    console.error(err);
                    valid = false;
                }
            }

            if (!valid) return;

            const proceedSave = () => {
                putJSONSync('/saveRadio', t, (err, res) => {
                    if (err) return ui.serviceError(err);

                    ui.successMessage(tr('MSG_SAVE_SUCCESS'));
                    get('btnSaveRadio').classList.remove('disabled');

                    const init = !!(res.config && res.config.radioInit);
                    const cb = get('cbEnableRadio');
                    this._radioInit = init;
                    this._radioEnabledSaved = !!(cb && cb.checked);
                    this.syncRadioEnableUi(cb, this._radioInit, this._radioEnabledSaved);
                });
            };
            if (isM) {
                let prompt = ui.promptMessage(get('divContainer'), tr('PROMPT_RADIO_MANUAL_TITLE'), () => {
                    proceedSave();
                });
                prompt.querySelector('.sub-message').innerHTML = `<p>${tr("PROMPT_RADIO_MANUAL_WARNING")}</p>`;
            } else {
                proceedSave();
            }
    }
    pinMaps = [
        { name: '', maxPins: 39, inputs: [0, 1, 6, 7, 8, 9, 10, 11, 37, 38], outputs: [3, 6, 7, 8, 9, 10, 11, 34, 35, 36, 37, 38, 39] },
        { name: 's2', maxPins: 46, inputs: [0, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 45], outputs: [0, 19, 20, 26, 27, 28, 29, 30, 31, 32, 45, 46]},
        { name: 's3', maxPins: 48, inputs: [19, 20, 22, 23, 24, 25, 27, 28, 29, 30, 31, 32], outputs: [19, 20, 22, 23, 24, 25, 27, 28, 29, 30, 31, 32] },
        { name: 'c3', maxPins: 21, inputs: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], outputs: [11, 12, 13, 14, 15, 16, 17, 21] }
    ];
    loadPins(type, sel, opt) {
        if (!sel) return;
        let currentVal = (typeof opt !== 'undefined') ? opt : parseInt(sel.value, 10);
        while (sel.firstChild) sel.removeChild(sel.firstChild);

        let cm = get('divContainer').getAttribute('data-chipmodel');
        let pm = this.pinMaps.find(x => x.name === cm);
        if (!pm) {
            pm = { name: '', maxPins: 39, inputs: [0, 1, 6, 7, 8, 9, 10, 11, 37, 38], outputs: [3, 6, 7, 8, 9, 10, 11, 34, 35, 36, 37, 38, 39] };
        }

        for (let i = 0; i <= pm.maxPins; i++) {

            if (type.includes('in') && pm.inputs.includes(i)) continue;
            if (type.includes('out') && pm.outputs.includes(i)) continue;

            sel.options[sel.options.length] = new Option(
                `GPIO-${i > 9 ? i.toString() : '0' + i.toString()}`,
                                                         i
            );
        }
        if (!isNaN(currentVal)) {
            sel.value = currentVal;
        }
    }
    procFrequencyScan(scan) {
        // console.log(scan);
        let div = this.scanFrequency();
        let spanTestFreq = get('spanTestFreq');
        let spanTestRSSI = get('spanTestRSSI');
        let spanBestFreq = get('spanBestFreq');
        let spanBestRSSI = get('spanBestRSSI');

        if (spanBestFreq) {
            spanBestFreq.innerHTML = scan.RSSI !== -100 ? scan.frequency.fmt('###.00') : '----';
        }
        if (spanBestRSSI) {
            spanBestRSSI.innerHTML = scan.RSSI !== -100 ? scan.RSSI : '----';
        }
        if (spanTestFreq) {
            spanTestFreq.innerHTML = scan.testFreq.fmt('###.00');
        }
        if (spanTestRSSI) {
            spanTestRSSI.innerHTML = scan.testRSSI !== -100 ? scan.testRSSI : '----';

            if (this.rssiGraph) {
                this.rssiGraph.update(scan.testRSSI);
            }
        }
        if (scan.RSSI !== -100)
            div.setAttribute('data-frequency', scan.frequency);
    }
    scanFrequency(initScan) {
        if (this.isScanClosing) return;
        let div = get('divScanFrequency');

        if (!div) {
            div = document.createElement('div');
            div.id = 'divScanFrequency';
            div.className = 'inst-overlay';
            div.innerHTML = `
            <div class="instructions-content scanfreq-overlay">
            <div class="overlay-scroll-content">
            ${overlayHeader('SCANFREQ_TITLE', 'SCANFREQ_DESC', 'svg-tabRadio')}
            <p class="scanfreq-intro">${tr('SCANFREQ_SCAN_DESC')}</p>
            <div id="divScanFreqStatus" class="scanfreq-status" style="display:none;"></div>
            <div class="scanfreq-metrics">
            <div class="scanfreq-metric">
            <span class="scanfreq-metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#svg-tabRadio"></use></svg></span>
            <div class="scanfreq-metric-copy">
            <div class="scanfreq-metric-label">${tr('SCANFREQ_SCAN')}</div>
            <div class="scanfreq-metric-value"><span id="spanTestFreq">433.00</span><span>${tr('MHZ')}</span></div>
            <div class="scanfreq-metric-sub"><span id="spanTestRSSI">----</span> ${tr('DBM')}</div>
            </div>
            </div>
            <div class="scanfreq-metric is-best">
            <span class="scanfreq-metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#svg-succes"></use></svg></span>
            <div class="scanfreq-metric-copy">
            <div class="scanfreq-metric-label">${tr('SCANFREQ_FREQUENCY')}</div>
            <div class="scanfreq-metric-value"><span id="spanBestFreq">---.--</span><span>${tr('MHZ')}</span></div>
            <div class="scanfreq-metric-sub"><span id="spanBestRSSI">----</span> ${tr('DBM')}</div>
            </div>
            </div>
            </div>
            <div class="uniblocrRssiCanvas scanfreq-canvas"><canvas id="rssiCanvas"></canvas></div>
            <div class="button-container-col scanfreq-actions">
            <button id="btnStopScanning" type="button" onclick="somfy.stopScanningFrequency(true)">${tr('BT_STOP_SCAN')}</button>
            <div class="scanfreq-actions-row">
            <button id="btnRestartScanning" type="button" style="display:none" onclick="somfy.scanFrequency(true)">${tr('BT_START_SCAN')}</button>
            <button id="btnSaveScannedFrequency" type="button" style="display:none" onclick="somfy.saveScannedFrequency()">${tr('BT_SAVE_FREQUENCY')}</button>
            </div>
            <button id="btnCloseScanning" line type="button" style="display:none">${tr('BT_CLOSE')}</button>
            </div>
            <details class="scanfreq-help">
            <summary>
            <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#svg-info"></use></svg>
            <span>${tr('SCANFREQ_UNDERSTANDING_RSSI')}</span>
            <svg class="scanfreq-help-chevron" viewBox="0 0 24 24" aria-hidden="true"><use href="#svg-arrowDown"></use></svg>
            </summary>
            <p class="scanfreq-help-blurb">${tr('SCANFREQ_RSSI_EXPLANATION')}</p>
            <div class="scanfreqSignal">
            <div class="scanfreq-leg scanfreq-leg-good">
            <span class="scanfreq-leg-dot" aria-hidden="true"></span>
            <div class="scanfreq-leg-copy">
            <b>${tr('SCANFREQ_RSSI_EXCELLENT')}</b>
            <span>${tr('SCANFREQ_RSSI_EXCELLENT_DESC')}</span>
            </div>
            </div>
            <div class="scanfreq-leg scanfreq-leg-mid">
            <span class="scanfreq-leg-dot" aria-hidden="true"></span>
            <div class="scanfreq-leg-copy">
            <b>${tr('SCANFREQ_RSSI_WEAK')}</b>
            <span>${tr('SCANFREQ_RSSI_WEAK_DESC')}</span>
            </div>
            </div>
            <div class="scanfreq-leg scanfreq-leg-poor">
            <span class="scanfreq-leg-dot" aria-hidden="true"></span>
            <div class="scanfreq-leg-copy">
            <b>${tr('SCANFREQ_RSSI_NOISE')}</b>
            <span>${tr('SCANFREQ_RSSI_NOISE_DESC')}</span>
            </div>
            </div>
            </div>
            </details>
            </div>
            </div>`;

            shOverlay(div);
            div.querySelector('#btnCloseScanning').onclick = () => closeOverlay(div);

            if (this.scanObserver) this.scanObserver.disconnect();
            this.scanObserver = new MutationObserver(() => { if (!get('divScanFrequency')) this.terminateScanUI(true); });
            this.scanObserver.observe(get('divContainer'), { childList: true });

            this.rssiGraph = {
                points: [],
                maxPoints: 100,
                canvas: get('rssiCanvas'),
                update(val) {
                    const c = this.canvas;
                    if (!c) return;
                    const ctx = c.getContext('2d'), w = c.width = c.clientWidth, h = c.height = c.clientHeight;
                    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#f8a525';
                    const lblW = 50, gW = w - lblW;
                    let v = parseInt(val);
                    if (isNaN(v) || v === -100) v = -110;

                    this.points.push(v);
                    if (this.points.length > this.maxPoints) this.points.shift();

                    ctx.clearRect(0, 0, w, h);
                    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                    ctx.setLineDash([5, 5]);
                    ctx.font = "10px Arial";
                    ctx.fillStyle = "rgba(255,255,255,0.5)";

                    [-40, -70, -100].forEach(lv => {
                        const y = h - (((lv + 110) / 90) * h);
                        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
                        ctx.fillText(lv + " dBm", 5, y - 5);
                    });
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.strokeStyle = accent;
                    ctx.lineWidth = 2;
                    ctx.lineJoin = 'round';

                    const step = gW / (this.maxPoints - 1);
                    this.points.forEach((p, i) => {
                        const x = lblW + (i * step), y = h - (((p + 110) / 90) * h);
                        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                    });
                    ctx.stroke();

                    const grad = ctx.createLinearGradient(0, 0, 0, h);
                    grad.addColorStop(0, accent.includes('#') ? accent + '4D' : accent);
                    grad.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.lineTo(lblW + ((this.points.length - 1) * step), h);
                    ctx.lineTo(lblW, h);
                    ctx.fillStyle = grad;
                    ctx.fill();
                }
            };
        }
        if (initScan) {
            div.setAttribute('data-initscan', true);
            putJSONSync('/beginFrequencyScan', {}, (err) => {
                if (!err) {
                    ['btnStopScanning'].forEach(id => get(id).style.display = '');
                    ['btnRestartScanning', 'btnSaveScannedFrequency', 'btnCloseScanning'].forEach(id => {
                        const el = get(id);
                        if (el) el.style.display = 'none';
                    });
                    const status = get('divScanFreqStatus');
                    if (status) {
                        status.style.display = 'none';
                        status.textContent = '';
                    }
                    div.removeAttribute('data-applied');
                    div.removeAttribute('data-frequency');
                }
            });
        }
        return div;
    }
    setScannedFrequency() {
        if (!this.applyScannedFrequency()) return;
        closeOverlay(get('divScanFrequency'));
    }
    applyScannedFrequency() {
        const div = get('divScanFrequency');
        if (!div) return null;
        const freq = parseFloat(div.getAttribute('data-frequency'));
        if (typeof freq !== 'number' || isNaN(freq) || freq <= 0) return null;
        const slid = get('slidFrequency');
        if (!slid) return null;
        slid.value = Math.round(freq * 1000);
        this.frequencyChanged(slid);
        div.setAttribute('data-applied', '1');
        return freq;
    }
    stopScanningFrequency(killScan) {
        let div = get('divScanFrequency');
        if (!div) return;
        if (killScan !== true) {
            closeOverlay(div);
            return;
        }
        putJSONSync('/endFrequencyScan', {}, (err, trans) => {
            if (err) {
                ui.serviceError(err);
            } else {
                get('btnStopScanning').style.display = 'none';
                get('btnRestartScanning').style.display = '';
                get('btnCloseScanning').style.display = '';

                const applied = this.applyScannedFrequency();
                const status = get('divScanFreqStatus');
                const saveBtn = get('btnSaveScannedFrequency');
                if (applied != null) {
                    if (saveBtn) saveBtn.style.display = '';
                    if (status) {
                        status.style.display = '';
                        status.textContent = tr('SCANFREQ_APPLIED')
                            .replace('%1', applied.fmt('###.00'))
                            .replace('%2', tr('MHZ') || 'MHz');
                    }
                    ui.successMessage(tr('SCANFREQ_APPLIED_TOAST')
                        .replace('%1', applied.fmt('###.00'))
                        .replace('%2', tr('MHZ') || 'MHz'));
                } else {
                    if (saveBtn) saveBtn.style.display = 'none';
                    if (status) {
                        status.style.display = '';
                        status.textContent = tr('SCANFREQ_NO_RESULT');
                    }
                }
            }
        });
    }
    saveScannedFrequency() {
        const div = get('divScanFrequency');
        if (!this.applyScannedFrequency() && !(div && div.getAttribute('data-applied') === '1')) {
            return ui.errorMessage(get('divTransceiverSettings') || document.body, tr('SCANFREQ_NO_RESULT'));
        }
        if (div) closeOverlay(div);
        this.saveRadio();
    }
    terminateScanUI(killScan) {
        this.isScanClosing = true;

        if (this.scanObserver) {
            this.scanObserver.disconnect();
            this.scanObserver = null;
        }
        if (killScan) {
            putJSONSync('/endFrequencyScan', {}, (err) => {
                if (err) console.error(err);
            });
        }
        let div = get('divScanFrequency');
        if (div) closeOverlay(div);
        setTimeout(() => { this.isScanClosing = false; }, 1000);
    }

    btnDown = null;
    btnTimer = null;

    setStep(type, stepValue) {
        const map = {
            'freq':      { slider: 'slidFrequency',   container: '#stepButtons' },
            'bandwidth': { slider: 'slidRxBandwidth', container: '#stepButtonsRx' },
            'deviation': { slider: 'slidDeviation',   container: '#stepButtonsDeviation' }
        };

        const config = map[type];
        if (!config) return;

        const slider = get(config.slider);
        if (slider) slider.step = stepValue;

        const container = document.querySelector(config.container);
        if (container) {
            container.querySelectorAll(".step-btn").forEach(btn => btn.classList.remove("active"));
            const activeBtn = container.querySelector(`.step-btn[onclick*="${stepValue}"]`);
            if (activeBtn) activeBtn.classList.add("active");
        }
    }
    stepValue(sliderId, direction) {
        const slider = get(sliderId);
        if (!slider) return;
        const currentVal = parseFloat(slider.value);
        const step = parseFloat(slider.step) || 1;
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        let newVal = currentVal + (step * direction);
        if (newVal < min) newVal = min;
        if (newVal > max) newVal = max;

        slider.value = newVal;
        slider.dispatchEvent(new Event('input'));
    }
    checkEmptyState() {
        const getEl = id => get(id);
        const setDisp = (el, show, style = 'block') => { if (el) el.style.display = show ? style : 'none'; };
        const togglePair = (hasData, emptyId, contentId) => {
            setDisp(getEl(emptyId), !hasData);
            setDisp(getEl(contentId), hasData);
        };

        const divShadeControls = getEl('divShadeControls');
        const divGroupControls = getEl('divGroupControls');
        const divConfigPnl = getEl('divConfigPnl');
        const divHomePnl = getEl('divHomePnl');
        if (!divShadeControls || !divGroupControls) return;

        const isConfigOpen = divConfigPnl && divConfigPnl.style.display !== 'none';

        const shades = divShadeControls.querySelectorAll('.somfyShadeCtl');
        const groups = divGroupControls.querySelectorAll('.somfyGroupCtl');
        const hasRooms = _rooms.length > 1;
        const totalDevices = shades.length + groups.length;

        togglePair(hasRooms, 'divRoomEmptyState', 'divRoomListContent');
        togglePair(groups.length > 0, 'divGroupEmptyState', 'divGroupListContent');
        togglePair(shades.length > 0, 'divShadeEmptyState', 'divShadeListContent');

        const divRepeatList = getEl('divRepeatList');
        togglePair(divRepeatList && divRepeatList.children.length > 0, 'divRepeaterEmptyState', 'divRepeaterListContent');

        const divFixedCodeList = getEl('divFixedCodeList');
        togglePair(divFixedCodeList && divFixedCodeList.children.length > 0, 'divFixedCodeEmptyState', 'divFixedCodeListContent');

        let visibleShadesCount = 0, visibleGroupsCount = 0;
        shades.forEach(el => { if (!el.classList.contains('is-filtered-out')) visibleShadesCount++; });
        groups.forEach(el => { if (!el.classList.contains('is-filtered-out')) visibleGroupsCount++; });
        const visibleCount = visibleShadesCount + visibleGroupsCount;
        const showLogoHeader = getEl('showLogoHeader');
        if (showLogoHeader) {
            showLogoHeader.style.visibility = (isConfigOpen || totalDevices > 0 || hasRooms) ? 'visible' : 'hidden';
        }
        const welcome = totalDevices === 0 && !hasRooms;
        document.documentElement.classList.toggle('welcome-empty', !!(welcome && !isConfigOpen));
        if (divHomePnl) divHomePnl.style.display = (isConfigOpen || welcome) ? 'none' : '';
        this._syncHomeScenesVisibility();

        const divGetStarted = getEl('divGetStarted');
        const divNoDevice = getEl('divNoDevice');

        if (welcome) {
            setDisp(divGetStarted, !isConfigOpen, 'flex');
            setDisp(divNoDevice, false);
            setDisp(divShadeControls, false);
            setDisp(divGroupControls, false);
            if (typeof ui !== 'undefined') ui.updateWelcomeChecklist();
        } else {
            setDisp(divGetStarted, false);
            setDisp(divNoDevice, visibleCount === 0 && !isConfigOpen, 'flex');

            if (divShadeControls) divShadeControls.style.display = isConfigOpen ? 'none' : '';
            if (divGroupControls) divGroupControls.style.display = isConfigOpen ? 'none' : '';

            const divShadeListContent = getEl('divShadeListContent');
            const divGroupListContent = getEl('divGroupListContent');
            if (divShadeListContent) divShadeListContent.style.display = visibleShadesCount === 0 ? 'none' : '';
            if (divGroupListContent) divGroupListContent.style.display = visibleGroupsCount === 0 ? 'none' : '';
        }
    }
    procRoomAdded(room) {
        let r = _rooms.find(x => x.roomId === room.roomId);
        if (typeof r === 'undefined' || !r) {
            _rooms.push(room);
            _rooms.sort((a, b) => { return a.sortOrder - b.sortOrder });
            this.setRoomsList(_rooms);
            this.checkEmptyState();
        }
    }
    procRoomRemoved(room) {
        if (room.roomId === 0) return;
        let r = _rooms.find(x => x.roomId === room.roomId);
        if (typeof r !== 'undefined' && r.roomId === room.roomId) {
            _rooms = _rooms.filter(x => x.roomId !== room.roomId);
            _rooms.sort((a, b) => { return a.sortOrder - b.sortOrder });
            this.setRoomsList(_rooms);
            this.checkEmptyState();
            let rs = get('divRoomSelector');
            let ss = get('divShadeControls');
            let gs = get('divGroupControls');
            let ctls = ss.querySelectorAll('.somfyShadeCtl');
            for (let i = 0; i < ctls.length; i++) {
                let x = ctls[i];
                if (parseInt(x.getAttribute('data-roomid'), 10) === room.roomId)
                    x.setAttribute('data-roomid', '0');
            }
            ctls = gs.querySelectorAll('.somfyGroupCtl');
            for (let i = 0; i < ctls.length; i++) {
                let x = ctls[i];
                if (parseInt(x.getAttribute('data-roomid'), 10) === room.roomId)
                    x.setAttribute('data-roomid', '0');
            }
            if (parseInt(rs.getAttribute('data-roomid'), 10) === room.roomId) this.selectRoom(0);
        }
    }
    selectRoom(roomId) {
        document.querySelectorAll('.room-pill').forEach(pill => {
            const pId = parseInt(pill.getAttribute('data-roomid'), 10);
            pill.classList.toggle('active', pId === roomId);
        });
        const stage = get('divHomeCards');
        if (stage) {
            stage.classList.remove('is-switching');
            void stage.offsetWidth;
            stage.classList.add('is-switching');
        }
        const rs = get('divRoomSelector');
        if (rs) rs.setAttribute('data-roomid', String(roomId));
        try { localStorage.setItem('espsomfyLastRoom', String(roomId)); } catch (_) {}
        this.applyHomeFilter();
        this.refreshHomeChrome();
        this.checkEmptyState();
    }
    filterHome(q) {
        this._homeQuery = String(q || '').trim().toLowerCase();
        this.applyHomeFilter();
        this.checkEmptyState();
    }
    applyHomeFilter() {
        const q = this._homeQuery || '';
        const roomId = this.currentRoomId();
        const match = el => {
            const rId = parseInt(el.getAttribute('data-roomid'), 10);
            const roomOk = roomId === 0 || rId === roomId;
            if (!q) return roomOk;
            const name = ((el.querySelector('.shadectl-name, .groupctl-name') || {}).textContent || '').toLowerCase();
            const room = ((el.querySelector('.shadectl-room, .groupctl-room') || {}).textContent || '').toLowerCase();
            return roomOk && (name.indexOf(q) >= 0 || room.indexOf(q) >= 0);
        };
        document.querySelectorAll('.somfyShadeCtl').forEach(el => { el.classList.toggle('is-filtered-out', !match(el)); });
        document.querySelectorAll('.somfyGroupCtl').forEach(el => { el.classList.toggle('is-filtered-out', !match(el)); });
    }
    currentRoomId() {
        const active = document.querySelector('.room-pill.active');
        if (active) return parseInt(active.getAttribute('data-roomid'), 10) || 0;
        const rs = get('divRoomSelector');
        return rs ? (parseInt(rs.getAttribute('data-roomid'), 10) || 0) : 0;
    }
    refreshHomeChrome() {
        const roomId = this.currentRoomId();
        const room = (typeof _rooms !== 'undefined' ? _rooms : []).find(r => Number(r.roomId) === roomId);
        const name = room ? (room.name || (tr('HOME') || 'All')) : (tr('HOME') || 'All');
        const el = get('spanHomeRoomTitle');
        if (el) el.textContent = name;
        this.renderHomeFavorites();
        this.renderHomeScenes();
        this.refreshMeshGlance();
    }
    roomQuickAction(command) {
        putJSON('/roomCommand', { roomId: this.currentRoomId(), command }, (err) => {
            if (err) ui.serviceError(err);
        });
    }
    _shadeCount() {
        if (Array.isArray(this.shades)) return this.shades.length;
        const el = get('divShadeControls');
        return el ? el.querySelectorAll('.somfyShadeCtl').length : 0;
    }
    _syncHomeScenesVisibility() {
        const wrap = get('divHomeScenes');
        if (wrap) wrap.style.display = (this._autoOk && this._shadeCount() > 0) ? '' : 'none';
    }
    loadAutomation() {
        getJSON('/scenes', (err, data) => {
            this._autoOk = !err && data && Array.isArray(data.scenes);
            this.scenes = this._autoOk ? data.scenes : [];
            this._syncHomeScenesVisibility();
            this.renderHomeScenes();
        });
        getJSON('/schedules', (err, data) => {
            this.schedules = (!err && data && Array.isArray(data.schedules)) ? data.schedules : [];
        });
    }
    renderHomeScenes() {
        const list = get('divHomeScenesList');
        if (!list) return;
        const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const items = Array.isArray(this.scenes) ? this.scenes : [];
        if (!items.length) {
            list.innerHTML = `<span class="home-scene-empty">${esc(tr('SCHED_EMPTY'))}</span>`;
            return;
        }
        list.innerHTML = items.map(sc => {
            const room = (typeof _rooms !== 'undefined' ? _rooms : []).find(r => Number(r.roomId) === Number(sc.roomId));
            return `<div class="home-fav-chip home-scene-chip" title="${esc(tr('HOME_SCENE_RUN'))}" onclick="somfy.runScene(${Number(sc.id)})"><span class="home-scene-x" title="${esc(tr('HOME_SCENE_DELETE'))}" onclick="event.stopPropagation(); somfy.deleteScene(${Number(sc.id)})">×</span><strong>${esc(sc.name)}</strong><span>${esc(room ? room.name : '')}</span></div>`;
        }).join('');
    }
    runScene(id) {
        putJSON('/sceneCommand', { id: Number(id) }, (err) => {
            if (err) ui.serviceError(err);
        });
    }
    deleteScene(id) {
        putJSON('/scenes', { id: Number(id), delete: true }, (err) => {
            if (err) return ui.serviceError(err);
            this.loadAutomation();
        });
    }
    saveSceneFromRoom() {
        if (!this._autoOk) return ui.serviceError({ htmlError: 404, service: 'PUT /scenes', desc: 'Firmware v3.4.0 required' });
        const roomId = this.currentRoomId();
        const room = (typeof _rooms !== 'undefined' ? _rooms : []).find(r => Number(r.roomId) === roomId);
        const defaultName = room && roomId ? `${room.name} ${tr('HOME_QA_MY') || 'My'}` : (tr('HOME_SCENES') || 'Scene');
        const div = document.createElement('div');
        div.className = 'inst-overlay';
        div.innerHTML = `
            <div class="instructions-content">
            <div class="overlay-scroll-content">
            ${overlayHeader('HOME_SCENE_SAVE', 'HOME_SCENE_NAME', 'svg-favori')}
            <div class="unibloc">
            <label class="label" for="fldSceneName">${tr('HOME_SCENE_NAME')}</label>
            <input id="fldSceneName" class="inputAndSelect" type="text" maxlength="24" value="${String(defaultName).replace(/"/g, '')}" placeholder="${tr('HOME_SCENE_NAME_PH')}">
            </div>
            </div>
            <div class="hrDivFooter"></div>
            <div class="button-container-overlay">
            <button type="button" id="btnSaveScene">${tr('HOME_SCENE_SAVE')}</button>
            <button type="button" line id="btnCancelScene">${tr('BT_CANCEL_1')}</button>
            </div>
            </div>`;
        shOverlay(div);
        div.querySelector('#btnCancelScene').onclick = () => closeOverlay(div);
        div.querySelector('#btnSaveScene').onclick = () => {
            const name = (get('fldSceneName').value || '').trim() || defaultName;
            const steps = (this.shades || []).filter(s => {
                const t = Number(s.shadeType);
                if (t === 9 || t === 10) return false;
                return !roomId || Number(s.roomId) === roomId;
            }).map(s => ({
                shadeId: Number(s.shadeId),
                pos: parseInt(s.position, 10) || 0,
                tilt: (Number(s.tiltType) ? parseInt(s.tiltPosition, 10) : -1)
            }));
            putJSON('/scenes', { name, roomId, steps }, (err) => {
                if (err) return ui.serviceError(err);
                closeOverlay(div);
                this.loadAutomation();
            });
        };
        ui.setFocus(get('fldSceneName'), true);
    }
    openSchedules() {
        getJSON('/schedules', (err, data) => {
            if (err) return ui.serviceError(err);
            this.schedules = (data && data.schedules) || [];
            this._renderSchedulesOverlay();
        });
    }
    _schedDayLabel(i) {
        return ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][i] || '';
    }
    _renderSchedulesOverlay() {
        const existing = get('divSchedules');
        if (existing) existing.remove();
        const rooms = [{ roomId: 0, name: tr('SCHED_ALL_ROOMS') }].concat(typeof _rooms !== 'undefined' ? _rooms : []);
        const scenes = this.scenes || [];
        const cmdLabel = c => (c === 0 ? (tr('HOME_QA_OPEN')) : c === 2 ? (tr('HOME_QA_CLOSE')) : c === 3 ? 'Stop' : (tr('HOME_QA_MY')));
        const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const rows = (this.schedules || []).map(t => {
            const when = `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
            const days = [0, 1, 2, 3, 4, 5, 6].filter(d => (Number(t.days) ? (t.days & (1 << d)) : 1)).map(d => this._schedDayLabel(d)).join('');
            let target = '';
            if (Number(t.kind) === 1) {
                const sc = scenes.find(s => Number(s.id) === Number(t.target));
                target = sc ? sc.name : `${tr('SCHED_SCENE')} ${t.target}`;
            } else {
                const rm = rooms.find(r => Number(r.roomId) === Number(t.target));
                target = rm ? rm.name : `${tr('SCHED_ROOM')} ${t.target}`;
            }
            const extra = Number(t.kind) === 1 ? '' : ` · ${cmdLabel(t.cmd)}`;
            return `<div class="unibloc sched-item" data-id="${t.id}">
                <label class="toggle-row"><input type="checkbox" ${t.enabled ? 'checked' : ''} onchange="somfy.saveSchedule({id:${t.id}, enabled:this.checked})"><span>${when} ${esc(days)} — ${esc(target)}${esc(extra)}</span></label>
                <button type="button" class="home-scene-x" onclick="somfy.saveSchedule({id:${t.id}, delete:true})">×</button>
            </div>`;
        }).join('');
        const roomOpts = rooms.map(r => `<option value="${Number(r.roomId)}">${esc(r.name || '')}</option>`).join('');
        const sceneOpts = scenes.map(s => `<option value="${Number(s.id)}">${esc(s.name)}</option>`).join('');
        const dayBtns = [0, 1, 2, 3, 4, 5, 6].map(d => `<button type="button" class="sched-day on" data-day="${d}">${this._schedDayLabel(d)}</button>`).join('');
        const div = document.createElement('div');
        div.id = 'divSchedules';
        div.className = 'inst-overlay';
        div.innerHTML = `
            <div class="instructions-content">
            <div class="overlay-scroll-content">
            ${overlayHeader('SCHED_TITLE', 'SCHED_DESC', 'svg-tabSystem')}
            ${rows}
            <div class="sched-form">
            <span class="label">${tr('SCHED_TIME') || 'Time'}</span>
            <div class="sched-row">
            <input id="fldSchedHour" class="inputAndSelect" type="number" min="0" max="23" value="8" inputmode="numeric">
            <span>:</span>
            <input id="fldSchedMinute" class="inputAndSelect" type="number" min="0" max="59" value="0" inputmode="numeric">
            </div>
            <span class="label">${tr('SCHED_DAYS')}</span>
            <div class="sched-row" id="divSchedDays">${dayBtns}</div>
            <span class="label">${tr('SCHED_ADD')}</span>
            <div class="sched-row">
            <select id="selSchedKind" class="inputAndSelect" onchange="somfy._schedKindChanged()">
            <option value="0">${tr('SCHED_ROOM')}</option>
            <option value="1">${tr('SCHED_SCENE')}</option>
            </select>
            <select id="selSchedRoom" class="inputAndSelect">${roomOpts}</select>
            <select id="selSchedScene" class="inputAndSelect" style="display:none">${sceneOpts}</select>
            <select id="selSchedCmd" class="inputAndSelect">
            <option value="0">${tr('HOME_QA_OPEN')}</option>
            <option value="1">${tr('HOME_QA_MY')}</option>
            <option value="2">${tr('HOME_QA_CLOSE')}</option>
            </select>
            </div>
            </div>
            </div>
            <div class="hrDivFooter"></div>
            <div class="button-container-overlay">
            <button type="button" id="btnAddSched">${tr('SCHED_ADD')}</button>
            <button type="button" line id="btnCloseSched">${tr('BT_CANCEL_1')}</button>
            </div>
            </div>`;
        shOverlay(div);
        div.querySelector('#btnCloseSched').onclick = () => closeOverlay(div);
        div.querySelectorAll('#divSchedDays .sched-day').forEach(btn => {
            btn.onclick = () => btn.classList.toggle('on');
        });
        div.querySelector('#btnAddSched').onclick = () => {
            const kind = parseInt(get('selSchedKind').value, 10) || 0;
            let days = 0;
            div.querySelectorAll('#divSchedDays .sched-day.on').forEach(b => { days |= (1 << parseInt(b.getAttribute('data-day'), 10)); });
            this.saveSchedule({
                enabled: true,
                hour: parseInt(get('fldSchedHour').value, 10) || 0,
                minute: parseInt(get('fldSchedMinute').value, 10) || 0,
                days,
                kind,
                target: kind === 1 ? parseInt(get('selSchedScene').value, 10) || 0 : parseInt(get('selSchedRoom').value, 10) || 0,
                cmd: parseInt(get('selSchedCmd').value, 10) || 0
            });
        };
        this._schedKindChanged();
    }
    _schedKindChanged() {
        const kind = parseInt(get('selSchedKind')?.value, 10) || 0;
        if (get('selSchedRoom')) get('selSchedRoom').style.display = kind === 1 ? 'none' : '';
        if (get('selSchedScene')) get('selSchedScene').style.display = kind === 1 ? '' : 'none';
        if (get('selSchedCmd')) get('selSchedCmd').style.display = kind === 1 ? 'none' : '';
    }
    saveSchedule(obj) {
        putJSON('/schedules', obj, (err) => {
            if (err) return ui.serviceError(err);
            this.openSchedules();
        });
    }
    favKey() { return 'espsomfyHomeFavorites'; }
    getFavoriteIds() {
        try {
            const raw = JSON.parse(localStorage.getItem(this.favKey()) || '[]');
            return Array.isArray(raw) ? raw.map(Number).filter(n => n > 0) : [];
        } catch (_) { return []; }
    }
    toggleFavorite(shadeId) {
        const id = Number(shadeId);
        let ids = this.getFavoriteIds();
        if (ids.includes(id)) ids = ids.filter(x => x !== id);
        else ids.push(id);
        localStorage.setItem(this.favKey(), JSON.stringify(ids.slice(0, 12)));
        this.renderHomeFavorites();
    }
    renderHomeFavorites() {
        const wrap = get('divHomeFavorites');
        const list = get('divHomeFavoritesList');
        if (!wrap || !list) return;
        const ids = this.getFavoriteIds();
        const shades = Array.isArray(this.shades) ? this.shades : [];
        const items = ids.map(id => shades.find(s => Number(s.shadeId) === id)).filter(Boolean);
        if (!items.length) {
            wrap.style.display = 'none';
            list.innerHTML = '';
            return;
        }
        wrap.style.display = '';
        const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        list.innerHTML = items.map(s => {
            const room = (typeof _rooms !== 'undefined' ? _rooms : []).find(r => Number(r.roomId) === Number(s.roomId));
            return `<button type="button" class="home-fav-chip" title="${esc(tr('SHADE_FAVORITE_POSITION') || 'My')}" onclick="somfy.sendCommand(${Number(s.shadeId)}, 'my')"><strong>${esc(s.name)}</strong><span>${esc(room ? room.name : '')}</span></button>`;
        }).join('');
    }
    refreshMeshGlance() {
        // Mesh status lives in the top-bar icons (hover for details).
    }
    updateCapacityCounts() {
        const fmt = (id, ...a) => {
            let s = tr(id);
            a.forEach((v, i) => { s = s.split('{' + i + '}').join(String(v)); });
            return s;
        };
        const set = (key, n, max) => {
            const left = Math.max(0, max - n);
            const full = n >= max;
            document.querySelectorAll(`.cap-count[data-cap="${key}"]`).forEach(el => {
                el.textContent = `${n}/${max}`;
                el.title = fmt('CAP_LEFT', left);
                el.classList.toggle('cap-full', full);
            });
            document.querySelectorAll(`.cap-line[data-cap="${key}"]`).forEach(el => {
                el.textContent = `${fmt('CAP_OF', n, max)} · ${fmt('CAP_LEFT', left)}`;
                el.classList.toggle('cap-full', full);
            });
        };
        set('rooms', (this.rooms || []).filter(r => r.roomId).length, this.maxRooms || 24);
        set('shades', (this.shades || []).length, this.maxShades || 48);
        set('groups', (this.groups || []).length, this.maxGroupsUsable || 14);
    }
    setRoomsList(rooms) {
        this.rooms = rooms || [];
        let divCfg = '';
        const homeName = tr('HOME');
        const slider = get('divRoomSelector');
        let divPills = `<div class="room-pill active" data-roomid="0" onclick="somfy.selectRoom(0)">${homeName}</div>`;
        let divOpts = `<option value="0">${homeName}</option>`;
        _rooms = [{ roomId: 0, name: homeName }];

        rooms.sort((a, b) => a.sortOrder - b.sortOrder);
        rooms.forEach(room => {
            divPills += `<div class="room-pill animScale" data-roomid="${room.roomId}" onclick="somfy.selectRoom(${room.roomId})">${room.name}</div>`;
            // ... foreach room ...
            divCfg += `<div class="somfyRoom room-draggable" data-roomid="${room.roomId}">
            <div class="drag-handle"><svg class="icon-svg"><use href=#svg-drag></use></svg></div>
            <div class="room-name"><span class="name-text">${room.name}</span></div><span class="vr"></span>
            <div class="divEditDelete-svg" onclick="somfy.openEditRoom(${room.roomId});"><svg class="icon-svg"><use href=#svg-edit></use></svg></div>
            <div class="divEditDelete-svg" onclick="somfy.deleteRoom(${room.roomId});"><svg class="icon-svg"><use href=#svg-close></use></svg></div>
            </div>`;

            divOpts += `<option value="${room.roomId}">${room.name}</option>`;
            _rooms.push(room);
        });

        slider.innerHTML = divPills;
        slider.style.display = 'flex';

        const navContainer = document.querySelector('.room-nav-container');
        // Keep the room bar visible for the shade view toggle even with zero rooms.
        if (navContainer) navContainer.style.display = 'flex';

        get('divRoomList').innerHTML = divCfg;
        get('selShadeRoom').innerHTML = divOpts;
        get('selGroupRoom').innerHTML = divOpts;

        this.checkEmptyState();
        this.setListDraggable(get('divRoomList'), '.room-draggable', (list) => {
            let order = Array.from(list.querySelectorAll('.room-draggable')).map(item =>
            parseInt(item.getAttribute('data-roomid'), 10)
            );
            putJSONSync('/roomSortOrder', order, (err) => {
                if (err) ui.serviceError(err);
                else this.updateRoomsList();
            });
        });
        this.initRoomScroll(slider);
        this.updateCapacityCounts();
        let last = 0;
        try { last = parseInt(localStorage.getItem('espsomfyLastRoom') || '0', 10) || 0; } catch (_) { last = 0; }
        if (last && _rooms.some(r => Number(r.roomId) === last)) this.selectRoom(last);
        else this.applyHomeFilter();
    }
    initRoomScroll(c) {
        const update = () => {
            const btnL = get('btnScrollLeft'), btnR = get('btnScrollRight');
            if (c && btnL && btnR) {
                btnL.style.display = c.scrollLeft > 10 ? 'block' : 'none';
                btnR.style.display = c.scrollWidth > (c.scrollLeft + c.clientWidth + 10) ? 'block' : 'none';
            }
        };
        let isDown = 0, startX, scrollLeft;

        c.addEventListener('wheel', (e) => {
            if (e.deltaY) { e.preventDefault(); c.scrollLeft += e.deltaY; }
        }, { passive: false });

        c.onmousedown = (e) => {
            isDown = 1;
            c.style.cursor = 'grabbing';
            startX = e.pageX - c.offsetLeft;
            scrollLeft = c.scrollLeft;
        };

        const stop = () => { isDown = 0; c.style.cursor = 'grab'; };
        c.onmouseleave = c.onmouseup = stop;

        c.onmousemove = (e) => {
            if (!isDown) return;
            e.preventDefault();
            c.scrollLeft = scrollLeft - (e.pageX - c.offsetLeft - startX) * 2;
        };

        c.onscroll = update;
        window.onresize = update;
        setTimeout(update, 150);
        this.checkArrows = update;
    }
    scrollRooms(dir) {
        get('divRoomSelector')?.scrollBy({ left: dir * 200, behavior: 'smooth' });
    }
    setRepeaterList(addresses) {
        let divCfg = '';
        if (typeof addresses !== 'undefined') {
            for (let i = 0; i < addresses.length; i++) {

                divCfg += `<div class="somfyRepeater" data-address="${addresses[i]}"><div class="idRemoteAddress"><span class="AddrId-label">${tr("ADDR")}</span><span class="repeater-name">${addresses[i]}</span></div><div class="divEditDelete-svg" onclick="somfy.unlinkRepeater('${addresses[i]}');"><svg class="icon-svg"><use href=#svg-close></use></svg></div></div>`;
            }
        }
        get('divRepeatList').innerHTML = divCfg;
        this.checkEmptyState();
    }
    setFixedCodesList(list) {
        this.fixedCodes = Array.isArray(list) ? list : [];
        const el = get('divFixedCodeList');
        if (!el) return;
        let html = '';
        for (let i = 0; i < this.fixedCodes.length; i++) {
            const sw = this.fixedCodes[i];
            const ready = !!sw.ready;
            html += `<div class="somfyShade" data-fcid="${sw.id}">
                <div class="shade-name"><div class="name-text">${sw.name || ('RF Switch ' + sw.id)}</div>
                <div class="cfg-room">${sw.frequency} MHz · ${ready ? tr('FC_LEARNED') : tr('FC_NOT_LEARNED')}</div></div>
                <div class="uniRight" style="display:flex;gap:6px;align-items:center;">
                    <button type="button" class="button-outline" ${ready ? '' : 'disabled'} onclick="somfy.commandFixedCode(${sw.id},'off');">${tr('FC_OFF')}</button>
                    <button type="button" ${ready ? '' : 'disabled'} onclick="somfy.commandFixedCode(${sw.id},'on');">${tr('FC_ON')}</button>
                    <span class="switch"><input type="checkbox" ${sw.state ? 'checked' : ''} ${ready ? '' : 'disabled'} onchange="somfy.commandFixedCode(${sw.id}, this.checked ? 'on' : 'off');"><div></div></span>
                    <div class="divEditDelete-svg" onclick="somfy.openEditFixedCode(${sw.id});"><svg class="icon-svg"><use href=#svg-edit></use></svg></div>
                    <div class="divEditDelete-svg" onclick="somfy.deleteFixedCode(${sw.id});"><svg class="icon-svg"><use href=#svg-close></use></svg></div>
                </div>
            </div>`;
        }
        el.innerHTML = html;
        this.checkEmptyState();
    }
    showEditFixedCode(show) {
        if (!show && this._fcLearning) this.cancelFixedCodeLearn();
        const list = get('divFixedCodeListContainer');
        const edit = get('divEditFixedCode');
        if (!list || !edit) return;
        list.style.display = show ? 'none' : '';
        edit.style.display = show ? 'block' : 'none';
        const banner = get('divFixedCodeLearnBanner');
        if (banner) banner.style.display = 'none';
        if (!show) {
            this._setFixedCodeLearning(false);
            this._fcSessionCreated = false;
        }
    }
    cancelEditFixedCode() {
        if (this._fcLearning) this.cancelFixedCodeLearn();
        const id = parseInt(get('fldFixedCodeId').value || '0', 10);
        // Discard empty draft created only for learn/save in this session
        if (id && this._fcSessionCreated) {
            const sw = (this.fixedCodes || []).find(x => x.id === id);
            if (sw && !sw.ready && !sw.hasOn && !sw.hasOff) {
                putJSONSync('/deleteFixedCode', { id: id }, () => {
                    this.setFixedCodesList((this.fixedCodes || []).filter(x => x.id !== id));
                });
            }
        }
        this.showEditFixedCode(false);
    }
    openEditFixedCode(id) {
        const isNew = id === undefined || id === null || id === '';
        if (isNew && (this.fixedCodes || []).length >= (this.maxFixedCodes || 8)) {
            return ui.errorMessage(get('divSomfySettings') || get('divFixedCodes'), tr('ERR_DEVICE_LIMIT_REACHED') || 'Maximum RF switches reached');
        }
        this._fcSessionCreated = false;
        this.showEditFixedCode(true);
        if (isNew) {
            // Draft only — create on first Save or Learn (avoids orphan duplicates)
            this._populateFixedCodeForm(null);
            return;
        }
        const sw = (this.fixedCodes || []).find(x => x.id === id);
        this._populateFixedCodeForm(sw || { id: id });
    }
    _populateFixedCodeForm(sw) {
        const setVal = (elId, val) => { const el = get(elId); if (el) el.value = val; };
        const setTxt = (elId, val) => { const el = get(elId); if (el) el.textContent = val; };
        setVal('fldFixedCodeId', sw ? sw.id : 0);
        setVal('fldFixedCodeName', sw ? (sw.name || '') : '');
        setVal('fldFixedCodeFreq', sw ? sw.frequency : 433.92);
        setVal('fldFixedCodeRepeats', sw ? sw.repeats : 5);
        const cb = get('cbFixedCodeSingleButton');
        if (cb) cb.checked = !!(sw && sw.singleButton);
        const cbFlip = get('cbFixedCodeFlipCommands');
        if (cbFlip) cbFlip.checked = !!(sw && sw.flipCommands);
        setTxt('divFixedCodeOnStatus', sw && sw.hasOn ? tr('FC_LEARNED') : tr('FC_NOT_LEARNED'));
        setTxt('divFixedCodeOffStatus', sw && sw.hasOff ? tr('FC_LEARNED') : tr('FC_NOT_LEARNED'));
        this._setFixedCodeDetails(sw);
        this.onFixedCodeSingleButtonChanged();
        this._updateFixedCodeTestButtons(sw);
        this._setFixedCodeLearning(false);
        const result = get('divFixedCodeLearnResult');
        if (result) { result.style.display = 'none'; result.textContent = ''; }
        const nameEl = get('fldFixedCodeName');
        if (nameEl) setTimeout(() => nameEl.focus(), 50);
    }
    onFixedCodeSingleButtonChanged() {
        const single = !!(get('cbFixedCodeSingleButton') && get('cbFixedCodeSingleButton').checked);
        const offRow = get('divFixedCodeLearnOffRow');
        if (offRow) offRow.style.display = single ? 'none' : '';
        const onLabel = get('lblFixedCodeLearnOn');
        if (onLabel) onLabel.textContent = single ? tr('FC_LEARN_CODE') : tr('FC_LEARN_ON');
        const id = parseInt(get('fldFixedCodeId').value || '0', 10);
        const sw = id ? (this.fixedCodes || []).find(x => x.id === id) : null;
        this._updateFixedCodeTestButtons(sw);
    }
    _updateFixedCodeTestButtons(sw) {
        const row = get('divFixedCodeTestRow');
        const btnOn = get('btnFixedCodeTestOn');
        const btnOff = get('btnFixedCodeTestOff');
        if (!row) return;
        const hasOn = !!(sw && sw.hasOn);
        const hasOff = !!(sw && (sw.hasOff || (sw.singleButton && sw.hasOn)));
        const single = !!(sw && sw.singleButton) || !!(get('cbFixedCodeSingleButton') && get('cbFixedCodeSingleButton').checked);
        row.style.display = (hasOn || hasOff) ? '' : 'none';
        if (btnOn) {
            btnOn.style.display = hasOn ? '' : 'none';
            btnOn.disabled = !hasOn || !!this._fcLearning;
            btnOn.textContent = single ? tr('FC_TEST') : tr('FC_ON');
        }
        if (btnOff) {
            btnOff.style.display = (!single && hasOff) ? '' : 'none';
            btnOff.disabled = !hasOff || !!this._fcLearning;
        }
    }
    _setFixedCodeLearning(busy) {
        this._fcLearning = !!busy;
        const disable = !!busy;
        const ids = ['btnSaveFixedCode', 'btnCancelFixedCode', 'btnFixedCodeLearnOn', 'btnFixedCodeLearnOff',
            'fldFixedCodeName', 'fldFixedCodeFreq', 'fldFixedCodeRepeats', 'cbFixedCodeSingleButton',
            'cbFixedCodeFlipCommands', 'btnFixedCodeTestOn', 'btnFixedCodeTestOff'];
        for (let i = 0; i < ids.length; i++) {
            const el = get(ids[i]);
            if (el) el.disabled = disable;
        }
    }
    _fixedCodeFormPayload() {
        return {
            name: get('fldFixedCodeName').value || '',
            frequency: parseFloat(get('fldFixedCodeFreq').value || '433.92'),
            repeats: parseInt(get('fldFixedCodeRepeats').value || '5', 10),
            singleButton: !!(get('cbFixedCodeSingleButton') && get('cbFixedCodeSingleButton').checked),
            flipCommands: !!(get('cbFixedCodeFlipCommands') && get('cbFixedCodeFlipCommands').checked)
        };
    }
    _ensureFixedCodeId(done) {
        const id = parseInt(get('fldFixedCodeId').value || '0', 10);
        if (id > 0) return done(null, id);
        putJSONSync('/addFixedCode', this._fixedCodeFormPayload(), (err, sw) => {
            if (err) return done(err);
            this._fcSessionCreated = true;
            const list = this.fixedCodes || [];
            if (!list.find(x => x.id === sw.id)) list.push(sw);
            else {
                const idx = list.findIndex(x => x.id === sw.id);
                list[idx] = sw;
            }
            this.fixedCodes = list;
            get('fldFixedCodeId').value = sw.id;
            done(null, sw.id, sw);
        });
    }
    _setFixedCodeDetails(sw) {
        const onCode = get('divFixedCodeOnCode');
        const offCode = get('divFixedCodeOffCode');
        if (onCode) {
            onCode.textContent = (sw && sw.hasOn)
                ? tr('FC_LEARNED_CODE').replace('%s', sw.onCode || '').replace('%s', String(sw.onCount || 0)) + (sw.onPreview ? `\n${sw.onPreview}` : '')
                : '';
        }
        if (offCode) {
            offCode.textContent = (sw && sw.hasOff)
                ? tr('FC_LEARNED_CODE').replace('%s', sw.offCode || '').replace('%s', String(sw.offCount || 0)) + (sw.offPreview ? `\n${sw.offPreview}` : '')
                : '';
        }
    }
    saveFixedCode() {
        if (this._fcLearning) return ui.errorMessage(get('divEditFixedCode'), tr('FC_BUSY_LEARNING'));
        const id = parseInt(get('fldFixedCodeId').value || '0', 10);
        const obj = Object.assign(id > 0 ? { id: id } : {}, this._fixedCodeFormPayload());
        // New draft → add once. Existing → save. Never both.
        const url = id > 0 ? '/saveFixedCode' : '/addFixedCode';
        putJSONSync(url, obj, (err, sw) => {
            if (err) return ui.serviceError(err);
            this._fcSessionCreated = false;
            const list = this.fixedCodes || [];
            const idx = list.findIndex(x => x.id === sw.id);
            if (idx >= 0) list[idx] = sw; else list.push(sw);
            this.setFixedCodesList(list);
            this.showEditFixedCode(false);
        });
    }
    deleteFixedCode(id) {
        if (!confirm(tr('FC_DELETE_CONFIRM'))) return;
        putJSONSync('/deleteFixedCode', { id: id }, (err) => {
            if (err) return ui.serviceError(err);
            this.setFixedCodesList((this.fixedCodes || []).filter(x => x.id !== id));
        });
    }
    _fixedCodeCommandError(err) {
        if (err && (err.htmlError === 429 || err.status === 429 || err.cmdStatus === 'rate_limited' ||
            (typeof err === 'string' && err.indexOf('rate_limited') >= 0))) {
            return ui.errorToast(tr('FC_RATE_LIMITED'));
        }
        return ui.serviceError(err);
    }
    commandFixedCode(id, state) {
        putJSON('/fixedCodeCommand', { id: id, state: state }, (err, sw) => {
            if (err) return this._fixedCodeCommandError(err);
            this.procFixedCodeState(sw);
        });
    }
    testFixedCode(state) {
        if (this._fcLearning) return;
        const id = parseInt(get('fldFixedCodeId').value || '0', 10);
        if (!id) return;
        const single = !!(get('cbFixedCodeSingleButton') && get('cbFixedCodeSingleButton').checked);
        putJSON('/fixedCodeCommand', { id: id, state: single ? 'toggle' : state }, (err, sw) => {
            if (err) return this._fixedCodeCommandError(err);
            this.procFixedCodeState(sw);
        });
    }
    learnFixedCode(button) {
        if (this._fcLearning) return;
        this._ensureFixedCodeId((err, id) => {
            if (err) return ui.serviceError(err);
            const single = !!(get('cbFixedCodeSingleButton') && get('cbFixedCodeSingleButton').checked);
            putJSONSync('/saveFixedCode', Object.assign({ id: id }, this._fixedCodeFormPayload()), (err2) => {
                if (err2) return ui.serviceError(err2);
                this._startFixedLearn(id, single ? 'on' : button);
            });
        });
    }
    _startFixedLearn(id, button) {
        const banner = get('divFixedCodeLearnBanner');
        const progress = get('divFixedCodeLearnProgress');
        const result = get('divFixedCodeLearnResult');
        if (result) { result.style.display = 'none'; result.textContent = ''; }
        const testRow = get('divFixedCodeTestRow');
        if (testRow) testRow.style.display = 'none';
        if (banner) banner.style.display = '';
        if (progress) progress.textContent = tr('FC_LEARN_PROGRESS').replace('%s', '0').replace('%s', '--');
        this._setFixedCodeLearning(true);
        putJSONSync('/fixedCodeLearn', { id: id, button: button, action: 'start' }, (err) => {
            if (err) {
                this._setFixedCodeLearning(false);
                if (banner) banner.style.display = 'none';
                return ui.serviceError(err);
            }
        });
    }
    cancelFixedCodeLearn() {
        putJSONSync('/fixedCodeLearn', { action: 'cancel' }, () => {});
        const banner = get('divFixedCodeLearnBanner');
        if (banner) banner.style.display = 'none';
        this._setFixedCodeLearning(false);
        const id = parseInt(get('fldFixedCodeId').value || '0', 10);
        const sw = id ? (this.fixedCodes || []).find(x => x.id === id) : null;
        this._updateFixedCodeTestButtons(sw);
    }
    procFixedCodeState(sw) {
        if (!sw || !sw.id) return;
        const list = this.fixedCodes || [];
        const idx = list.findIndex(x => x.id === sw.id);
        if (idx >= 0) list[idx] = Object.assign({}, list[idx], sw);
        else list.push(sw);
        this.setFixedCodesList(list);
        if (parseInt(get('fldFixedCodeId').value || '0', 10) === sw.id) {
            get('divFixedCodeOnStatus').textContent = sw.hasOn ? tr('FC_LEARNED') : tr('FC_NOT_LEARNED');
            get('divFixedCodeOffStatus').textContent = sw.hasOff ? tr('FC_LEARNED') : tr('FC_NOT_LEARNED');
            const cb = get('cbFixedCodeSingleButton');
            if (cb && !this._fcLearning) cb.checked = !!sw.singleButton;
            const cbFlip = get('cbFixedCodeFlipCommands');
            if (cbFlip && !this._fcLearning && typeof sw.flipCommands !== 'undefined') cbFlip.checked = !!sw.flipCommands;
            this._setFixedCodeDetails(sw);
            this.onFixedCodeSingleButtonChanged();
            this._updateFixedCodeTestButtons(sw);
        }
    }
    procFixedCodeLearn(msg) {
        const banner = get('divFixedCodeLearnBanner');
        const progress = get('divFixedCodeLearnProgress');
        const result = get('divFixedCodeLearnResult');
        if (msg && msg.learning) {
            this._setFixedCodeLearning(true);
            if (banner) banner.style.display = '';
            if (progress) {
                const rssi = (msg.rssi != null) ? String(msg.rssi) : '--';
                progress.textContent = tr('FC_LEARN_PROGRESS').replace('%s', String(msg.pulseCount || 0)).replace('%s', rssi);
            }
            return;
        }
        this._setFixedCodeLearning(false);
        if (banner) banner.style.display = 'none';
        if (msg && msg.success) {
            if (result) {
                result.style.display = '';
                result.className = 'success';
                result.textContent = `${(msg.button || '').toUpperCase()} ${tr('FC_LEARNED')}: ${msg.code || ''} · ${msg.pulseCount || 0} pulses\n${msg.preview || ''}`;
            }
            getJSON('/fixedCodes', (err, list) => {
                if (!err) this.setFixedCodesList(list);
                const id = parseInt(get('fldFixedCodeId').value || '0', 10);
                if (id) {
                    const sw = (this.fixedCodes || []).find(x => x.id === id);
                    if (sw) {
                        get('divFixedCodeOnStatus').textContent = sw.hasOn ? tr('FC_LEARNED') : tr('FC_NOT_LEARNED');
                        get('divFixedCodeOffStatus').textContent = sw.hasOff ? tr('FC_LEARNED') : tr('FC_NOT_LEARNED');
                        this._setFixedCodeDetails(sw);
                        this.onFixedCodeSingleButtonChanged();
                        this._updateFixedCodeTestButtons(sw);
                    }
                }
            });
        } else if (msg && !msg.cancelled) {
            if (result) {
                result.style.display = '';
                result.className = 'information';
                const rssi = (typeof msg.rssi === 'number') ? msg.rssi : null;
                const pulses = msg.pulseCount || 0;
                let tip = tr('FC_LEARN_FAILED');
                if (msg.reason === 'weak_rssi') tip = tr('FC_LEARN_FAILED_WEAK') || tip;
                else if (msg.reason === 'too_few_pulses') tip = tr('FC_LEARN_FAILED_SHORT') || tip;
                else if (msg.reason === 'bad_timing' || msg.reason === 'noisy') tip = tr('FC_LEARN_FAILED_NOISE') || tip;
                const detail = [
                    pulses ? `${pulses} pulses` : '',
                    (rssi != null) ? `RSSI ${rssi} dBm` : ''
                ].filter(Boolean).join(' · ');
                result.textContent = detail ? `${tip}\n${detail}` : tip;
            }
            const id = parseInt(get('fldFixedCodeId').value || '0', 10);
            const sw = id ? (this.fixedCodes || []).find(x => x.id === id) : null;
            this._updateFixedCodeTestButtons(sw);
        }
    }
    procFixedCodeRemoved(msg) {
        if (!msg || !msg.id) return;
        this.setFixedCodesList((this.fixedCodes || []).filter(x => x.id !== msg.id));
    }
    setShadesList(shades) {
        this.shades = shades;
        let divCfg = '';
        let divCtl = '';
        shades.sort((a, b) => { return a.sortOrder - b.sortOrder });
        let vrList = get('selVRMotor');
        // First get the optiongroup for the shades.
        let optGroup = get('optgrpVRShades');
        if (typeof shades === 'undefined' || shades.length === 0) {
            if (optGroup && typeof optGroup !== 'undefined') optGroup.remove();
        }
        else {
            if (typeof optGroup === 'undefined' || !optGroup) {
                optGroup = document.createElement('optgroup');
                optGroup.setAttribute('id', 'optgrpVRShades');
                optGroup.setAttribute('label', 'Shades');
                vrList.appendChild(optGroup);
            }
            else {
                optGroup.innerHTML = '';
            }
        }
        for (let i = 0; i < shades.length; i++) {
            let shade = shades[i];
            let room = _rooms.find(x => x.roomId === shade.roomId) || { roomId: 0, name: '' };
            let isLightOn = (shade.flags & 0x08);
            let isSunOn = (shade.flags & 0x01);
            let st = this.shadeTypes.find(x => x.type === shade.shadeType) || { type: shade.shadeType, ico: 'svg-window-shade' };

            divCfg += `<div class="somfyShade shade-draggable" draggable="true" data-roomid="${shade.roomId}" data-mypos="${shade.myPos}" data-shadeid="${shade.shadeId}" data-remoteaddress="${shade.remoteAddress}" data-tilt="${shade.tiltType}" data-shadetype="${shade.shadeType}" data-flipposition="${shade.flipPosition ? 'true' : 'false'}"><div class="drag-handle"><svg class="icon-svg"><use href=#svg-drag></use></svg></div><div class="shade-name"><div class="cfg-room">${room.name}</div><div class="name-text">${shade.name}</div></div><div class="idRemoteAddress"><span class="AddrId-label">${tr("ID")}</span><span class="shade-address">${shade.remoteAddress}</span></div><span class="vr"></span><div class="divEditDelete-svg" onclick="somfy.openEditShade(${shade.shadeId});"><svg class="icon-svg"><use href=#svg-edit></use></svg></div><div class="divEditDelete-svg" onclick="somfy.deleteShade(${shade.shadeId});"><svg class="icon-svg"><use href=#svg-close></use></svg></div></div>`;
            const canPos = this.canSetPosition(shade.shadeType);
            const posClick = canPos ? `onclick="event.stopPropagation(); somfy.openSetPosition(${shade.shadeId});"` : '';
            divCtl += `<div class="somfyShadeCtl${canPos ? ' can-position' : ''}" style="--pos:${shade.position};--mypos:${shade.myPos}" data-shadeid="${shade.shadeId}" data-roomid="${shade.roomId}" data-direction="${shade.direction}" data-remoteaddress="${shade.remoteAddress}" data-position="${shade.position}" data-target="${shade.target}" data-mypos="${shade.myPos}" data-mytiltpos="${shade.myTiltPos}" data-shadetype="${shade.shadeType}" data-tilt="${shade.tiltType}" data-flipposition="${shade.flipPosition ? 'true' : 'false'}"
            data-windy="${(shade.flags & 0x10) === 0x10 ? 'true' : 'false'}" data-sunny="${(shade.flags & 0x20) === 0x20 ? 'true' : 'false'}">
            <div class="shadectl-main-content">
            <div class="shade-icon" data-shadeid="${shade.shadeId}" ${posClick}>
            <svg class="somfy-shade-icon" data-shadeid="${shade.shadeId}" style="--shade-position:${this.iconVisualPosition(shade.position, shade.flipPosition, shade.shadeType)}; --fpos:${shade.position}%">
            <use href="#${st.ico}"></use>
            </svg>
            </div>
            <div class="shadectl-meta">
            <span class="shadectl-name">${shade.name}</span>
            <span class="shadectl-room">${room.name}</span>
            </div>
            <button type="button" class="shadectl-pos-pill" ${posClick} title="${tr('SHADE_SET_POSITION') || 'Set position'}">
            <span class="val-pos">${this.formatPosLabel(shade.position)}</span>`;
            if (shade.tiltType !== 0) divCtl += `<span class="val-pos shadectl-tilt">Tilt ${shade.tiltPosition}%</span>`;
            if (shade.myPos >= 0) divCtl += `<span class="val-my shadectl-my">${tr('HOME_QA_MY') || 'My'} ${this.formatPosLabel(shade.myPos)}</span>`;
            divCtl += `</button>
            <div class="shadectl-buttons" data-shadeType="${shade.shadeType}">
            <div class="button-outline cmd-button btn-somfy-svg animScale" data-cmd="up" data-shadeid="${shade.shadeId}"><svg><use href="#svg-up"></use></svg></div>
            <div class="button-outline cmd-button btn-somfy-svg animScale" data-cmd="my" data-shadeid="${shade.shadeId}"><svg><use href="#svg-my"></use></svg></div>
            <div class="button-outline cmd-button btn-somfy-svg animScale" data-cmd="down" data-shadeid="${shade.shadeId}"><svg><use href="#svg-down"></use></svg></div>
            <div class="button-outline cmd-button btn-somfy-svg-wide animScale" data-cmd="toggle" data-shadeid="${shade.shadeId}"><svg><use href="#svg-toggle"></use></svg></div>
            </div>
            <button type="button" class="shadectl-more" data-shadeid="${shade.shadeId}" title="${tr('HOME_MORE') || 'More'}" aria-label="${tr('HOME_MORE') || 'More'}">
            <svg><use href="#svg-more"></use></svg>
            </button>
            </div>
            <div class="shadectl-track" ${posClick} title="${tr('SHADE_SET_POSITION') || 'Set position'}">
            <div class="shadectl-track-fill"></div>
            <div class="shadectl-track-my"></div>
            </div>
            <div class="shadectl-status-bar">
            <div class="shadectl-status-left">
            <div class="indicator indicator-wind"><svg><use href="#indic-wind"></use></svg></div>
            <div class="indicator indicator-sun"><svg><use href="#indic-sun"></use></svg></div>
            </div>
            <div class="status-group-right">
            <div class="button-light cmd-button" data-cmd="light" data-shadeid="${shade.shadeId}" data-on="${isLightOn ? 'true' : 'false'}" style="${!shade.light ? 'display:none' : ''}">
            <svg><use href="#svg-lightbulb"></use></svg>
            </div>`;
            if (shade.sunSensor) {
                divCtl += `<div class="button-sunflag cmd-button" data-cmd="sunflag" data-shadeid="${shade.shadeId}" data-on="${isSunOn ? 'true' : 'false'}">
                <svg><use href="#svg-sun"></use></svg>
                </div>`;
            }
            divCtl += `<div class="button-cfg" title="${tr('SHADE_CONFIGURE')}" onclick="event.stopPropagation(); somfy.configureShade(${shade.shadeId});">
            <svg><use href="#svg-cfg"></use></svg>
            </div>
            <div class="button-pin${this.getFavoriteIds().includes(Number(shade.shadeId)) ? ' is-pinned' : ''}" title="${tr('HOME_PIN_FAVORITE') || 'Pin to Home'}" onclick="event.stopPropagation(); somfy.toggleFavorite(${shade.shadeId});">
            <svg><use href="#svg-favori"></use></svg>
            </div>
            <div class="button-my${shade.myPos >= 0 ? ' has-mypos' : ''}" title="${shade.myPos >= 0 ? ((tr('HOME_QA_MY') || 'My') + ' ' + this.formatPosLabel(shade.myPos)) : (tr('SHADE_FAVORITE_POSITION'))}" onclick="event.stopPropagation(); somfy.openSetMyPosition(${shade.shadeId});">
            <svg><use href="#svg-my"></use></svg>
            </div></div></div></div>`;

            let opt = document.createElement('option');
            opt.textContent = room.name ? `${room.name} - ${shade.name}` : shade.name;

            opt.setAttribute('data-address', shade.remoteAddress);
            opt.setAttribute('data-type', 'shade');
            opt.setAttribute('data-shadetype', shade.shadeType);
            opt.setAttribute('data-shadeid', shade.shadeId);
            opt.setAttribute('data-bitlength', shade.bitLength);
            optGroup.appendChild(opt);
        }
        let sopt = vrList.options[vrList.selectedIndex];
        get('divVirtualRemote').setAttribute('data-bitlength', sopt ? sopt.getAttribute('data-bitlength') : 'none');
        get('divShadeList').innerHTML = divCfg;
        let shadeControls = get('divShadeControls');
        shadeControls.innerHTML = divCtl;
        this.ensureHomeCmdDelegation();
        this.applyHomeFilter();
        this.checkEmptyState();
        this.refreshHomeChrome();
        this.setListDraggable(get('divShadeList'), '.shade-draggable', (list) => {
            // Get the shade order
            let items = list.querySelectorAll('.shade-draggable');
            let order = [];
            for (let i = 0; i < items.length; i++) {
                order.push(parseInt(items[i].getAttribute('data-shadeid'), 10));
                // Reorder the shades on the main page.
            }
            putJSONSync('/shadeSortOrder', order, (err) => {
                for (let i = order.length - 1; i >= 0; i--) {
                    let el = shadeControls.querySelector(`.somfyShadeCtl[data-shadeid="${order[i]}"`);
                    if (el) {
                        shadeControls.prepend(el);
                    }
                }
            });
        });
        this.updateCapacityCounts();
        if (typeof alexa !== 'undefined') {
            const panel = get('divAlexa');
            if (panel && panel.style.display !== 'none') alexa.renderList();
            alexa.refreshCount();
        }
    }
    setListDraggable(list, cl, cb) {
        let el = null, gh = null, ch = false, sA = null;
        let r = null, sY = 0, cY = 0, its = [];

        const stop = () => { if(sA) cancelAnimationFrame(sA); sA = null; };
        const scroll = (y) => {
            stop();
            let sp = 0;
            if (y < 100) sp = -14;
            else if (y > window.innerHeight - 100) sp = 14;

            if (sp && gh) {
                window.scrollBy(0, sp);
                cY += sp;
                gh.style.transform = "translateY(" + (cY - sY) + "px)";
                sA = requestAnimationFrame(() => scroll(y));
                sort();
            }
        };
        const sort = () => {
            if (!el || !gh) return;
            let mid = gh.getBoundingClientRect().top + (r.height / 2);
            let idx = its.indexOf(el);

            its.forEach((it, i) => {
                if (it === el) return;
                let iM = it.getBoundingClientRect().top + (r.height / 2);
                let o = 0;
                if (mid < iM && its.indexOf(el) > i) {
                    o = r.height + 10;
                    if(i < idx) idx = i;
                } else if (mid > iM && its.indexOf(el) < i) {
                    o = -(r.height + 10);
                    if(i >= idx) idx = i + 1;
                }
                it.style.transform = o ? "translateY(" + o + "px)" : "";
            });
            el.dataset.idx = idx;
        };
        const end = () => {
            stop();
            if (gh) { gh.remove(); gh = null; }
            if (el) {
                el.classList.remove('drag-orig');
                let n = parseInt(el.dataset.idx, 10), o = its.indexOf(el);
                if (!isNaN(n) && n !== o) {
                    list.insertBefore(el, its[n] || null);
                    ch = true;
                }
            }
            its.forEach(it => it.style.transform = "");
            if (ch && typeof cb === 'function') cb(list);
            el = null; ch = false; its = [];
        };
        const move = (e) => {
            if (!gh) return;
            if (e.cancelable) e.preventDefault();
            let t = e.touches ? e.touches[0] : e;
            cY = t.clientY;
            gh.style.transform = "translateY(" + (cY - sY) + "px)";
            scroll(cY);
            sort();
        };
        const start = (e, it) => {
            if (e.type === 'mousedown') e.preventDefault();
            el = it;
            r = el.getBoundingClientRect();
            its = Array.prototype.slice.call(list.querySelectorAll(cl));
            let t = e.touches ? e.touches[0] : e;
            sY = cY = t.clientY;

            gh = el.cloneNode(true);
            gh.className = 'drag-ghost';

            const style = window.getComputedStyle(el);
            Object.assign(gh.style, {
                width: r.width + 'px',
                height: r.height + 'px',
                top: r.top + 'px',
                left: r.left + 'px',
            });
            document.body.appendChild(gh);
            el.classList.add('drag-orig');
            if (navigator.vibrate) navigator.vibrate(30);
        };

            list.querySelectorAll(cl).forEach(it => {
                let h = it.querySelector('.drag-handle');
                if (h) {
                    h.addEventListener('touchstart', (e) => start(e, it), {passive:true});
                    h.addEventListener('mousedown', (e) => start(e, it));
                }
            });
            window.addEventListener('touchmove', move, {passive:false});
            window.addEventListener('touchend', end);
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', end);
    }
    setGroupsList(groups) {
        this.groups = groups;
        let divCfg = '';
        let divCtl = '';
        let vrList = get('selVRMotor');
        let optGroup = get('optgrpVRGroups');

        if (typeof groups === 'undefined' || groups.length === 0) {
            if (optGroup) optGroup.remove();
        } else {
            if (!optGroup) {
                optGroup = document.createElement('optgroup');
                optGroup.setAttribute('id', 'optgrpVRGroups');
                optGroup.setAttribute('label', 'Groups');
                vrList.appendChild(optGroup);
            } else {
                optGroup.innerHTML = '';
            }
        }
        if (typeof groups !== 'undefined') {
            groups.sort((a, b) => a.sortOrder - b.sortOrder);

            for (let i = 0; i < groups.length; i++) {
                let group = groups[i];
                let room = _rooms.find(x => x.roomId === group.roomId) || { roomId: 0, name: '' };
                // --- Section Configuration ---
                divCfg += `<div class="somfyGroup group-draggable" draggable="true" data-roomid="${group.roomId}" data-groupid="${group.groupId}" data-remoteaddress="${group.remoteAddress}"><div class="drag-handle"><svg class="icon-svg"><use href=#svg-drag></use></svg></div> <div class="group-name"><div class="cfg-room">${room.name}</div><div class="name-text">${group.name}</div></div><div class="idRemoteAddress"><span class="AddrId-label">${tr("ID")}</span><span class="group-address">${group.remoteAddress}</span></div><span class="vr"></span><div class="divEditDelete-svg" onclick="somfy.openEditGroup(${group.groupId});"><svg class="icon-svg"><use href=#svg-edit></use></svg></div><div class="divEditDelete-svg" onclick="somfy.deleteGroup(${group.groupId});"><svg class="icon-svg" style="color: var(--danger-color, red);"><use href=#svg-close></use></svg></div></div>`;
                // --- Section Contrôle (divCtl) ---
                divCtl += `<div class="somfyGroupCtl" data-groupId="${group.groupId}" data-roomid="${group.roomId}" data-remoteaddress="${group.remoteAddress}">
                <div class="group-name">
                <span class="groupctl-room">${room.name}</span>
                <span class="groupctl-name">${group.name}</span>
                <div class="groupctl-shades">`;
                if (typeof group.linkedShades !== 'undefined') {
                    divCtl += `<label>Members:</label><span>${group.linkedShades.length}</span>`;
                }
                divCtl += `</div></div>
                <div class="groupctl-buttons">
                <div class="button-sunflag cmd-button" data-cmd="sunflag" data-groupid="${group.groupId}" data-on="${(group.flags & 0x01) ? 'true' : 'false'}" style="${!group.sunSensor ? 'display:none' : ''}"><svg><use href="#svg-sun"></use></svg></div>
                <div class="button-outline cmd-button btn-somfy-svg animScale" data-cmd="up" data-groupid="${group.groupId}"><svg><use href="#svg-up"></use></svg></div>
                <div class="button-outline cmd-button btn-somfy-svg animScale" data-cmd="my" data-groupid="${group.groupId}"><svg><use href="#svg-my"></use></svg></div>
                <div class="button-outline cmd-button btn-somfy-svg animScale" data-cmd="down" data-groupid="${group.groupId}"><svg><use href="#svg-down"></use></svg></div>
                </div>
                </div>`;

                let opt = document.createElement('option');
                opt.textContent = room.name ? `${room.name} - ${group.name}` : group.name;
                opt.setAttribute('data-address', group.remoteAddress);
                opt.setAttribute('data-type', 'group');
                opt.setAttribute('data-groupid', group.groupId);
                opt.setAttribute('data-bitlength', group.bitLength);
                optGroup.appendChild(opt);
            }
        }
        let sopt = vrList.options[vrList.selectedIndex];
        get('divVirtualRemote').setAttribute('data-bitlength', sopt ? sopt.getAttribute('data-bitlength') : 'none');
        get('divGroupList').innerHTML = divCfg;
        let groupControls = get('divGroupControls');
        groupControls.innerHTML = divCtl;
        this.ensureHomeCmdDelegation();
        this.applyHomeFilter();
        this.checkEmptyState();
        this.setListDraggable(get('divGroupList'), '.group-draggable', (list) => {
            // Get the shade order
            let items = list.querySelectorAll('.group-draggable');
            let order = [];
            for (let i = 0; i < items.length; i++) {
                order.push(parseInt(items[i].getAttribute('data-groupid'), 10));
                // Reorder the shades on the main page.
            }
            putJSONSync('/groupSortOrder', order, (err) => {
                for (let i = order.length - 1; i >= 0; i--) {
                    let el = groupControls.querySelector(`.somfyGroupCtl[data-groupid="${order[i]}"`);
                    if (el) {
                        groupControls.prepend(el);
                    }
                }
            });
        });
        this.updateCapacityCounts();
    }
    closeShadePositioners() {
        this.dismissPositioners(false);
    }
    openSetMyPosition(shadeId) {
        if (typeof shadeId === 'undefined') return;

        const shade = document.querySelector(`div.somfyShadeCtl[data-shadeid="${shadeId}"]`);
        if (!shade) return;

        const existing = shade.querySelector('.shade-positioner');
        if (existing) {
            this.dismissPositioners();
            return;
        }
        this.dismissPositioners(false);

        const currPos = parseInt(shade.getAttribute('data-position'), 10) || 0;
        const currTiltPos = parseInt(shade.getAttribute('data-tiltposition'), 10) || 0;
        const myPos = parseInt(shade.getAttribute('data-mypos'), 10);
        const myTiltPos = parseInt(shade.getAttribute('data-mytiltpos'), 10);
        const tiltType = parseInt(shade.getAttribute('data-tilt'), 10) || 0;
        const scaleHint = tr('POPUP_POS_SCALE') || '100% open · 0% closed';

        const positionSlider = (tiltType !== 3) ? `
        <div class="slider-group">
        <div class="slider-header"><span class="title">${tr('POPUP_TARGET_POSITION')}</span><span class="val"><span id="spanShadeTarget">${currPos}</span>%</span></div>
        <div class="uniStatus pos-scale-hint">${scaleHint}</div>
        <input id="slidShadeTarget" type="range" min="0" max="100" step="1" value="${currPos}" oninput="get('spanShadeTarget').innerHTML=this.value;">
        </div>` : '';

        const tiltSlider = (tiltType > 0) ? `
        <div class="slider-group">
        <div class="slider-header"><span class="title">${tr('POPUP_TARGET_TILT_POSITION')}</span><span class="val"><span id="spanShadeTiltTarget">${currTiltPos}</span>%</span></div>
        <div class="uniStatus pos-scale-hint">${scaleHint}</div>
        <input id="slidShadeTiltTarget" type="range" min="0" max="100" step="1" value="${currTiltPos}" oninput="get('spanShadeTiltTarget').innerHTML=this.value;">
        </div>` : '';

        const div = document.createElement('div');
        div.className = 'shade-positioner shade-positioner-popup';
        div.setAttribute('data-shadeid', shadeId);
        div.onclick = (e) => e.stopPropagation();
        div.innerHTML = `
        <div class="shade-positioner-inner">
        <button type="button" class="pos-close" aria-label="${tr('BT_CANCEL_1') || 'Close'}"><svg class="icon-svg"><use href="#svg-close"></use></svg></button>
        ${positionSlider}${tiltSlider}
        <div class="popup-actions">
        <button id="btnSetMyPosition" pop type="button">${tr("BT_SET_MY_POSITION")}</button>
        <button id="btnCancelMy" pop line type="button">${tr("BT_CANCEL_1")}</button>
        </div>
        </div>`;

        shade.appendChild(div);

        const animateClose = () => this.dismissPositioners();
        const elTarget = div.querySelector('#slidShadeTarget');
        const elTiltTarget = div.querySelector('#slidShadeTiltTarget');
        const elBtnSave = div.querySelector('#btnSetMyPosition');
        const elBtnCancel = div.querySelector('#btnCancelMy');
        const fnUpdateUI = () => {
            const pos = elTarget ? parseInt(elTarget.value, 10) : 0;
            const tilt = elTiltTarget ? parseInt(elTiltTarget.value, 10) : 0;
            const isSameAsMy = (tiltType === 3) ? (tilt === myTiltPos) : (pos === myPos && (tiltType === 0 || tilt === myTiltPos));

            if (isSameAsMy) {
                elBtnSave.innerHTML = tr('BT_CLEAR_MY_POSITION');
                elBtnSave.style.background = 'var(--txtwarning-color)';
            } else {
                elBtnSave.innerHTML = tr('BT_SET_MY_POSITION');
                elBtnSave.style.background = '';
            }
        };
        if (elTarget) elTarget.oninput = () => {
            get('spanShadeTarget').innerHTML = elTarget.value;
            fnUpdateUI();
        };
        if (elTiltTarget) elTiltTarget.oninput = () => {
            get('spanShadeTiltTarget').innerHTML = elTiltTarget.value;
            fnUpdateUI();
        };

        const elClose = div.querySelector('.pos-close');
        if (elClose) elClose.onclick = (e) => { e.preventDefault(); e.stopPropagation(); animateClose(); };
        elBtnCancel.onclick = (e) => { e.preventDefault(); animateClose(); };
        elBtnSave.onclick = (e) => {
            e.preventDefault();
            const pos = elTarget ? parseInt(elTarget.value, 10) : 0;
            const tilt = elTiltTarget ? parseInt(elTiltTarget.value, 10) : 0;
            somfy.sendShadeMyPosition(shadeId, pos, tilt);
            animateClose();
        };

        setTimeout(() => {
            document.body.addEventListener('click', animateClose, { once: true });
        }, 100);

        fnUpdateUI();
    }
    sendShadeMyPosition(shadeId, pos, tilt) {
        console.log(`Sending My Position for shade id ${shadeId} to ${pos} and ${tilt}`);
        let overlay = ui.waitMessage(get('divContainer'));
        putJSON('/setMyPosition', { shadeId: shadeId, pos: pos, tilt: tilt }, (err, response) => {
            this.closeShadePositioners();
            overlay.remove();
            console.log(response);
        });
    }
    setCalibratePositionSlider(pos) {
        const g = get;
        const p = Math.max(0, Math.min(100, parseInt(pos, 10) || 0));
        if (g('slidCalibratePos')) g('slidCalibratePos').value = p;
        if (g('spanCalibratePos')) g('spanCalibratePos').innerText = p;
    }
    onFlipPositionChanged() {
        // Keep calibrate slider aligned with reported % after toggle + save;
        // live preview uses current reported position from the label.
        const g = get;
        if (g('valPos')) this.setCalibratePositionSlider(g('valPos').innerText);
    }
    _applyCalibratedShadeUi(shade) {
        const g = get;
        if (!shade || typeof shade.position === 'undefined') return false;
        if (g('valPos')) g('valPos').innerText = shade.position;
        this.setCalibratePositionSlider(shade.position);
        if (g('cbFlipPosition') && typeof shade.flipPosition !== 'undefined') {
            g('cbFlipPosition').checked = !!shade.flipPosition;
        }
        if (g('cbExposeAlexa') && typeof shade.exposeAlexa !== 'undefined') {
            g('cbExposeAlexa').checked = !!shade.exposeAlexa;
        }
        if (g('cbFlipCommands') && typeof shade.flipCommands !== 'undefined') {
            g('cbFlipCommands').checked = !!shade.flipCommands;
        }
        const shadeId = shade.shadeId;
        const shadeType = shade.shadeType ?? shade.type;
        this.applyShadeIconPosition(g('icoShade'), shade.position, shade.flipPosition, shadeType);
        document.querySelectorAll(`.somfyShadeCtl[data-shadeid="${shadeId}"]`).forEach(d => {
            d.dataset.position = shade.position;
            d.dataset.target = shade.target;
            d.dataset.flipposition = shade.flipPosition ? 'true' : 'false';
            d.style.setProperty('--pos', shade.position);
            const spans = d.querySelectorAll('.val-pos');
            if (spans[0]) spans[0].innerText = this.formatPosLabel(shade.position);
        });
        document.querySelectorAll(`.somfy-shade-icon[data-shadeid="${shadeId}"]`).forEach(el => {
            this.applyShadeIconPosition(el, shade.position, shade.flipPosition, shadeType);
        });
        return true;
    }
    calibrateShadePosition() {
        const g = get;
        const shadeId = parseInt(g('spanShadeId')?.innerText, 10);
        if (isNaN(shadeId) || shadeId >= 255) {
            return ui.errorMessage(g('divSomfySettings'), tr('ERR_SHADE_ID_REQUIRED'));
        }
        const pos = parseInt(g('slidCalibratePos')?.value, 10);
        if (isNaN(pos) || pos < 0 || pos > 100) return;
        // Save invert flags + position together so Apply matches the checkboxes on screen
        // (wording-only labels; field names remain flipPosition / flipCommands / position).
        const payload = {
            shadeId,
            flipPosition: !!(g('cbFlipPosition') && g('cbFlipPosition').checked),
            flipCommands: !!(g('cbFlipCommands') && g('cbFlipCommands').checked),
            position: pos
        };
        putJSONSync('/saveShade', payload, (err, shade) => {
            if (err) return ui.serviceError(err);
            if (!this._applyCalibratedShadeUi(shade)) {
                return ui.errorMessage(g('divSomfySettings'), 'Calibration failed');
            }
            ui.successMessage(tr('MSG_SAVE_SUCCESS'));
        });
    }
    setLinkedRemotesList(shade) {
        const container = get('divLinkedRemoteList');
        const remotes = shade.linkedRemotes || [];

        if (remotes.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }
        container.style.display = 'block';

        let html = `<div class="linkedRheader">${tr("LINKED_R")}</div>`;

        html += `<div class="linkedScrollArea">`;
        html += remotes.map((remote, i) => `
        ${i > 0 ? '<hr>' : ''}
        <div class="somfyLinkedRemote" data-shadeid="${shade.shadeId}" data-remoteaddress="${remote.remoteAddress}"><div class="linkedWrap"><svg class="icon-svg"><use href=#svg-remote></use></svg></div><div class="linkedContent"><div class="label">${tr("LINKED_R_T")} ${i + 1}</div><div><span class="uniStatus">${tr("ADDR")} ${remote.remoteAddress}, </span><span class="uniStatus">${tr("CODE")} ${remote.lastRollingCode}</span></div></div><div class="button-outline-svg svgDelete" onclick="somfy.unlinkRemote(${shade.shadeId}, '${remote.remoteAddress}');"><svg class="icon-svg"><use href=#svg-close></use></svg></div></div>
        `).join('');

        html += `</div>`;

        container.innerHTML = html;
    }
    setLinkedShadesList(group) {
        const container = get('divLinkedShadeList');
        const btnContainer = get('divSomfyGroupButtons');
        const btnLink = get('btnLinkShade');
        const shades = group.linkedShades || [];

        if (shades.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
        } else {
            container.style.display = 'block';
        }
        const hasShades = shades.length > 0;
        if (btnContainer) {
            if (!hasShades) {
                btnContainer.classList.add('disabled');
            } else {
                btnContainer.classList.remove('disabled');
            }
        }
        ui.setFocus(btnLink, !hasShades);

        if (!hasShades) return;

        let html = `<div class="linkedRheader">${tr("GROUP_LINKED_S")}</div>`;

        html += `<div class="linkedScrollArea">`;
        html += shades.map((shade, i) => `
        ${i > 0 ? '<hr>' : ''}
        <div class="somfyLinkedRemote" data-shadeid="${shade.shadeId}" data-remoteaddress="${shade.remoteAddress}">
        <div class="linkedWrap"><svg class="icon-svg"><use href=#svg-simpleShutter></use></svg></div><div class="linkedContent"><div class="label">${shade.name}</div><div><span class="uniStatus">${tr("ADDR")} ${shade.remoteAddress}</span></div></div><div class="button-outline-svg svgDelete" onclick="somfy.unlinkGroupShade(${group.groupId}, ${shade.shadeId});"><svg class="icon-svg"><use href=#svg-close></use></svg></div></div>
        `).join('');

        html += `</div>`;

        container.innerHTML = html;
    }
    procGroupState(state) {
        console.log(state);
        let flags = document.querySelectorAll(`.button-sunflag[data-groupid="${state.groupId}"]`);
        for (let i = 0; i < flags.length; i++) {
            flags[i].style.display = state.sunSensor ? '' : 'none';
            flags[i].setAttribute('data-on', state.flags & 0x20 === 0x20 ? 'true' : 'false');
        }
    }
    procShadeState(state) {
        const g = get, sId = state.shadeId;

        const shadeType = state.shadeType ?? state.type;
        document.querySelectorAll(`.somfy-shade-icon[data-shadeid="${sId}"]`).forEach(ico => {
            this.applyShadeIconPosition(ico, state.position, state.flipPosition, shadeType);
        });
        if (g('spanShadeId')?.innerText == sId) {
            if (g('valPos')) g('valPos').innerText = state.position;
            // Keep calibrate slider in sync with live reported position.
            if (g('divCalibratePosition')?.style.display !== 'none') {
                this.setCalibratePositionSlider(state.position);
            }

            const lTC = g('labelTiltContainer'), sVT = g('valTilt');
            if (state.tiltType !== 0) {
                if (lTC) lTC.style.display = 'block';
                if (sVT) sVT.innerText = state.tiltPosition;
            } else if (lTC) {
                lTC.style.display = 'none';
            }
        }
        document.querySelectorAll(`.button-sunflag[data-shadeid="${sId}"]`).forEach(btn => {
            btn.style.display = state.sunSensor ? '' : 'none';
            btn.dataset.on = (state.flags & 0x01) === 0x01;
        });
        document.querySelectorAll(`.somfyShadeCtl[data-shadeid="${sId}"]`).forEach(d => {
            Object.assign(d.dataset, {
                direction: state.direction,
                position: state.position,
                target: state.target,
                mypos: state.myPos,
                windy: (state.flags & 0x10) === 0x10,
                          sunny: (state.flags & 0x20) === 0x20,
                          mytiltpos: state.myTiltPos ?? -1
            });

            if (state.tiltType !== 0) {
                Object.assign(d.dataset, {
                    tiltdirection: state.tiltDirection,
                    tiltposition: state.tiltPosition,
                    tilttarget: state.tiltTarget
                });
            }

            d.style.setProperty('--pos', state.position);
            d.style.setProperty('--mypos', state.myPos);
            const spans = d.querySelectorAll('.val-pos');
            if (spans[0]) spans[0].innerText = this.formatPosLabel(state.position);
            if (state.tiltType !== 0 && spans[1]) spans[1].innerText = `Tilt ${state.tiltPosition}%`;
            const myEl = d.querySelector('.val-my');
            if (state.myPos >= 0) {
                const txt = `${tr('HOME_QA_MY') || 'My'} ${this.formatPosLabel(state.myPos)}`;
                if (myEl) myEl.innerText = txt;
                else {
                    const pill = d.querySelector('.shadectl-pos-pill');
                    if (pill) {
                        const s = document.createElement('span');
                        s.className = 'val-my shadectl-my';
                        s.innerText = txt;
                        pill.appendChild(s);
                    }
                }
            } else if (myEl) myEl.remove();
            const myBtn = d.querySelector('.button-my');
            if (myBtn) {
                myBtn.classList.toggle('has-mypos', state.myPos >= 0);
                myBtn.title = state.myPos >= 0
                    ? `${tr('HOME_QA_MY') || 'My'} ${this.formatPosLabel(state.myPos)}`
                    : (tr('SHADE_FAVORITE_POSITION') || 'My');
            }
            if (Array.isArray(this.shades)) {
                const rec = this.shades.find(s => Number(s.shadeId) === Number(sId));
                if (rec) {
                    rec.position = state.position;
                    rec.myPos = state.myPos;
                    if (state.tiltPosition !== undefined) rec.tiltPosition = state.tiltPosition;
                }
            }
        });
    }
    procRemoteFrame(frame) {
        const qs = (s) => get(s);
        qs('spanRssi').innerHTML = frame.rssi;
        qs('spanFrameCount').innerHTML = parseInt(qs('spanFrameCount').innerHTML || 0, 10) + 1;

        const lnk = qs('divLinking') || qs('divLinkRepeater');
        if (lnk) {
            const isRepeater = lnk.id === 'divLinkRepeater';
            const url = isRepeater ? '/linkRepeater' : '/linkRemote';
            const obj = isRepeater ? {address: frame.address} : {
                shadeId: parseInt(lnk.dataset.shadeid, 10),
                remoteAddress: frame.address,
                rollingCode: frame.rcode
            };

            const overlay = ui.waitMessage(lnk);
            putJSON(url, obj, (err, data) => {
                overlay.remove();
                lnk.remove();
                if (err) ui.serviceError(err);
                else isRepeater ? this.setRepeaterList(data) : this.setLinkedRemotesList(data);
            });
        }
        const dt = new Date();
        const timeStr = `${dt.getHours().fmt('00')}:${dt.getMinutes().fmt('00')}:${dt.getSeconds().fmt('00')}.${dt.getMilliseconds().fmt('000')}`;
        const protos = { 1: '-W', 2: '-V' };
        const proto = protos[frame.proto] || '-S';
        const row = document.createElement('div');
        row.className = 'frame-row';
        row.dataset.valid = frame.valid;

        row.innerHTML = `<span>${frame.encKey}</span><span>${frame.address}</span><span>${frame.command}<sup>${frame.stepSize || ''}</sup></span><span>${frame.rcode}</span><span>${frame.rssi}dBm</span><span>${frame.bits}${proto}</span><span title="${timeStr}">${timeStr}</span><span class="frame-src" title="${frame.src || ''}">${frame.src || '—'}</span><div class="frame-pulses">${(frame.pulses || []).join(',')}</div>`;

        qs('divFrames').prepend(row);
        this.frames.push(frame);
        if (typeof mesh !== 'undefined') mesh.logFrame('RX', frame);
    }
    procTxFrame(frame) {
        if (typeof mesh !== 'undefined') mesh.logFrame('TX', frame);
        if (localStorage.getItem('rfTxDebug') !== '1') return;
        const list = get('divTxFrames');
        if (!list) return;
        const empty = list.querySelector('.tx-debug-empty');
        if (empty) empty.remove();
        const dt = new Date();
        const timeStr = `${dt.getHours().fmt('00')}:${dt.getMinutes().fmt('00')}:${dt.getSeconds().fmt('00')}.${dt.getMilliseconds().fmt('000')}`;
        const protos = { 1: '-W', 2: '-V' };
        const proto = protos[frame.proto] || '-S';
        const cmd = frame.cmd || frame.command || '';
        const frames = frame.frames != null ? frame.frames : (1 + (frame.repeats || 0));
        const followUps = frame.repeats != null ? frame.repeats : Math.max(0, frames - 1);
        const row = document.createElement('div');
        row.className = 'tx-debug-row';
        row.innerHTML = `<span>${frames}</span><span>${frame.address}</span><span>${cmd}</span><span>${frame.rcode}</span><span>${followUps}</span><span>${frame.bits || ''}${proto}</span><span>${timeStr}</span>`;
        list.prepend(row);
        while (list.children.length > 200) list.lastChild.remove();
        this.txFrames.push(Object.assign({ time: timeStr }, frame));
        if (this.txFrames.length > 200) this.txFrames.shift();
        if (typeof general !== 'undefined') general.refreshTxDebugChrome();
    }
    clearFrameLogs() {
        const rx = get('divFrames');
        if (rx) rx.innerHTML = '';
        this.frames = [];
    }
    clearTxFrameLogs() {
        const tx = get('divTxFrames');
        if (tx && typeof general !== 'undefined') general.renderTxDebugEmpty(tx);
        else if (tx) tx.innerHTML = '<div class="tx-debug-empty" tr="TX_DEBUG_EMPTY">Waiting for TX… press Up/Down/My</div>';
        this.txFrames = [];
        if (typeof general !== 'undefined') general.refreshTxDebugChrome();
    }
    txFramesToClipboard() {
        const text = this.JSONPretty(this.txFrames, 2);
        if (typeof navigator.clipboard !== 'undefined')
            navigator.clipboard.writeText(text);
        else {
            let dummy = document.createElement('textarea');
            document.body.appendChild(dummy);
            dummy.value = text;
            dummy.focus();
            dummy.select();
            document.execCommand('copy');
            document.body.removeChild(dummy);
        }
    }
    JSONPretty(obj, indent = 2) {
        if (Array.isArray(obj)) {
            let output = '[';
            for (let i = 0; i < obj.length; i++) {
                if (i !== 0) output += ',\n';
                output += this.JSONPretty(obj[i], indent);
            }
            output += ']';
            return output;
        }
        else {
            let output = JSON.stringify(obj, function (k, v) {
                if (Array.isArray(v)) return JSON.stringify(v);
                return v;
            }, indent).replace(/\\/g, '')
            .replace(/\"\[/g, '[')
            .replace(/\]\"/g, ']')
            .replace(/\"\{/g, '{')
                .replace(/\}\"/g, '}')
                .replace(/\{\n\s+/g, '{');
                    return output;
                }
        }
    JSONPretty(obj, indent = 2) {
        if (Array.isArray(obj)) {
            let output = '[';
            for (let i = 0; i < obj.length; i++) {
                if (i !== 0) output += ',\n';
                output += this.JSONPretty(obj[i], indent);
            }
            output += ']';
            return output;
        }
        else {
            let output = JSON.stringify(obj, function (k, v) {
                if (Array.isArray(v)) return JSON.stringify(v);
                return v;
            }, indent).replace(/\\/g, '')
            .replace(/\"\[/g, '[')
            .replace(/\]\"/g, ']')
            .replace(/\"\{/g, '{')
            .replace(/\}\"/g, '}')
            .replace(/\{\n\s+/g, '{');
                return output;
            }
    }
    framesToClipboard() {
        const payload = (localStorage.getItem('rfTxDebug') === '1')
            ? { rx: this.frames, tx: this.txFrames }
            : this.frames;
        const text = this.JSONPretty(payload, 2);
        if (typeof navigator.clipboard !== 'undefined')
            navigator.clipboard.writeText(text);
        else {
            let dummy = document.createElement('textarea');
            document.body.appendChild(dummy);
            dummy.value = text;
            dummy.focus();
            dummy.select();
            document.execCommand('copy');
            document.body.removeChild(dummy);
        }
    }
    onShadeTypeChanged(el) {
        const g = get,
        type = parseInt(g('selShadeType').value, 10),
        tilt = parseInt(g('selTiltType').value, 10),
        bitL = g('selShadeBitLength')?.value,
        ico = g('icoShade'),
        isNew = g('spanShadeId').innerText === '*',
        st = this.shadeTypes.find(x => x.type === type) || { type };

        ['somfyShade', 'divSomfyButtons'].forEach(id => g(id)?.setAttribute('data-shadetype', type));

        if (ico) {

            this.shadeTypes.forEach(t => t.ico !== st.ico && ico.classList.remove(t.ico));

            const use = ico.querySelector('use');
            if (use && st.ico) {
                const href = '#' + st.ico;
                use.setAttribute('href', href);
                use.setAttribute('xlink:href', href);
            }
        }
        const hasLift = !!st.lift;
        const curTilt = st.tilt ? tilt : 0;
        const showLiftSettings = hasLift && tilt !== 3;
        const disp = (id, cond, d = 'block') => {
            const e = g(id);
            if (e) e.style.display = cond ? d : 'none';
        };

            disp('divTiltSettings', st.tilt);
            disp('divShadeTimings', hasLift);
            disp('divLiftSettings', showLiftSettings);
            disp('divSunSensor', st.sun);
            disp('divLightSwitch', st.light);
            disp('divFlipPosition', st.fpos);
            disp('divFlipCommands', st.fcmd);
            disp('divExposeAlexa', type !== 9 && type !== 10);

            const fldTilt = g('fldTiltTime')?.parentElement;
            if (fldTilt) fldTilt.style.display = curTilt ? 'inline-block' : 'none';

            const showStepHR = [7, 8, 2, 4, 0].includes(type) || (type === 1 && [2, 3, 4].includes(tilt));

        disp('hrDivStepSettings', showStepHR);
        disp('hrTiltSettings', curTilt !== 3);
        disp('hrDldTiltTime', !(curTilt === 0 && bitL === "56"));
        disp('labelPosContainer', hasLift && !isNew);
        disp('labelTiltContainer', curTilt && !isNew);

        if (!st.light && g('cbHasLight')) g('cbHasLight').checked = false;
        if (!st.sun && g('cbHasSunsensor')) g('cbHasSunsensor').checked = false;
    }
    onShadeBitLengthChanged(el) {
        get('somfyShade').setAttribute('data-bitlength', el.value);
        this.onShadeTypeChanged(el);
    }
    onShadeProtoChanged(el) {
        get('somfyShade').setAttribute('data-proto', el.value);
    }
    openEditRoom(roomId) {
        if (typeof roomId === 'undefined') {
            const nRooms = _rooms.filter(r => r.roomId).length;
            if (nRooms >= (this.maxRooms || 24)) {
                ui.errorMessage(get('divSomfySettings'), tr('ERR_ROOM_LIMIT_REACHED'));
                return;
            }
            get('btnSaveRoom').innerText = tr('BT_CREATE');
            getJSONSync('/getNextRoom', (err, room) => {
                get('spanRoomId').innerText = '*';
                if (err) ui.serviceError(err);
                else {
                    console.log(room);
                    let elRoom = get('somfyRoom');
                    room.name = '';
                    ui.toElement(elRoom, room);
                    this.showEditRoom(true);
                }
            });
        }
        else {
            get('btnSaveRoom').innerText = tr('BT_SAVE');
            getJSONSync(`/room?roomId=${roomId}`, (err, room) => {
                if (err) ui.serviceError(err);
                else {
                    console.log(room);
                    get('spanRoomId').innerText = roomId;
                    ui.toElement(get('somfyRoom'), room);
                    this.showEditRoom(true);
                    get('btnSaveRoom').style.display = 'inline-block';
                }
            });
        }
    }
    configureShade(shadeId) {
        // Open Devices settings for this shade from the home dashboard.
        ui.setConfigPanel();
        const parentTab = document.querySelector('.tab-container [data-grpid="divSomfySettings"]');
        if (parentTab) ui.selectTab(parentTab);
        const motorTab = document.querySelector('.subtab-container [data-grpid="divSomfyMotors"]');
        if (motorTab) ui.selectTab(motorTab);
        this.openEditShade(shadeId);
    }
    openEditShade(shadeId) {
        const g = get,
        isNew = shadeId === undefined,
        ico = g('icoShade'),
        btns = ['btnPairShade', 'btnUnpairShade', 'btnForceUnpairShade', 'btnLinkRemote', 'hrSetRollingC', 'btnSetRollingCode'];

        if (isNew && this.shades?.length >= (this.maxShades || 48))
            return ui.errorMessage(g('divSomfySettings'), tr('ERR_DEVICE_LIMIT_REACHED'));

        const s = (id, d) => { const e = g(id); if(e) e.style.display = d; };

        s('divshowSomfyButtons', 'flex');
        g('divshowSomfyButtons')?.classList.toggle('disabled', isNew);
        btns.forEach(id => s(id, 'none'));
        ['blocPairDevice', 'divLinkedRemoteList', 'labelPosContainer', 'labelPosHint', 'divCalibratePosition'].forEach(id => s(id, 'none'));

        getJSONSync(isNew ? '/getNextShade' : `/shade?shadeId=${shadeId}`, (err, shade) => {
            if (err) return ui.serviceError(err);

            if (isNew) {
                Object.assign(shade, {
                    name: '', shadeType: 4, roomId: 0, downTime: 10000, upTime: 10000,
                    tiltTime: 7000, tiltType: 0, flipCommands: 0, flipPosition: 0, paired: 0, sunSensor: 0, simMy: 0, repeats: 0
                });
            }
            if (!isNew) {
                s('labelPosContainer', 'block');
                s('labelPosHint', 'block');
                s('blocPairDevice', 'flex');
                s('divCalibratePosition', 'block');
                ['btnLinkRemote', 'btnSetRollingCode'].forEach(id => s(id, 'flex'));
                s('hrSetRollingC', 'block');
                s(shade.paired ? 'btnUnpairShade' : 'btnPairShade', 'inline-block');
                s('btnForceUnpairShade', shade.paired ? 'none' : 'inline-block');
                s('divRemoteIdTip', shade.paired ? 'none' : 'block');

                if (g('valPos')) g('valPos').innerText = shade.position;
                this.setCalibratePositionSlider(shade.position);
                this.setLinkedRemotesList(shade);
            } else {
                s('labelPosHint', 'none');
                s('divCalibratePosition', 'none');
                s('divRemoteIdTip', 'block');
            }

            if (g('valTilt')) g('valTilt').innerText = shade.tiltPosition || 0;

            ui.setFocus('btnPairShade', !isNew && !shade.paired);

            const rev = shade.flipPosition,
            tp = rev ? 100 - shade.tiltPosition : shade.tiltPosition;

            if (ico) {
                this.applyShadeIconPosition(ico, shade.position, shade.flipPosition, shade.shadeType);
                ico.style.setProperty('--tilt-position', tp + '%');
                ico.setAttribute('data-shadeid', isNew ? '*' : shadeId);
            }
            g('btnSaveShade').innerText = tr(isNew ? 'BT_CREATE' : 'BT_SAVE');
            g('spanShadeId').innerText = isNew ? '*' : shadeId;

            ui.toElement(g('somfyShade'), shade);
            if (g('selShadeBitLength')) g('somfyShade').setAttribute('data-bitlength', g('selShadeBitLength').value);
            this.onShadeTypeChanged(g('selShadeType'));
            this.showEditShade(true);
        });
    }
    openEditGroup(groupId) {
        const g = get,
        isNew = groupId === undefined,
        elGroup = g('somfyGroup'),
        btnLink = g('btnLinkShade'),
        btnSave = g('btnSaveGroup'),
        btnContainer = g('divSomfyGroupButtons'),
        divLinkedShades = g('divLinkedShadeList'),
        blocPairParent = g('blocPairGroup');

        if (isNew && this.groups?.length >= 14)
            return ui.errorMessage(g('divSomfySettings'), tr('ERR_GROUP_LIMIT_REACHED'));

        const s = (idOrElem, d) => { const e = (typeof idOrElem === 'string') ? g(idOrElem) : idOrElem; if(e) e.style.display = d; };

        divLinkedShades.innerHTML = '';

        s(btnContainer, 'flex');
        btnContainer?.classList.toggle('disabled', isNew);
        s(btnLink, 'none');
        s(btnSave, 'none');
        s(blocPairParent, 'none');
        s(divLinkedShades, 'none');

        getJSONSync(isNew ? '/getNextGroup' : `/group?groupId=${groupId}`, (err, group) => {
            if (err) return ui.serviceError(err);

            if (isNew) {
                Object.assign(group, {
                    name: '', flipCommands: false, shades: []
                });
            }
            if (!isNew) {
                s(btnLink, 'inline-block');
                s(blocPairParent, 'flex');
                s(divLinkedShades, 'block');

                const hasShades = (group.shades && group.shades.length > 0);
                btnContainer?.classList.toggle('disabled', !hasShades);

                ui.setFocus(btnLink, !isNew && !hasShades);
                this.setLinkedShadesList(group);
            }
            g('btnSaveGroup').innerText = tr(isNew ? 'BT_CREATE' : 'BT_SAVE');
            s(btnSave, 'inline-block');
            g('spanGroupId').innerText = isNew ? '*' : groupId;

            ui.toElement(elGroup, group);
            this.showEditGroup(true);
        });
    }
    showEditRoom(bShow) {
        let el = get('divLinking');
        if (el) el.remove();
        el = get('divLinkRepeater');
        if (el) el.remove();
        el = get('divPairing');
        if (el) el.remove();
        el = get('divRollingCode');
        if (el) el.remove();
        el = get('somfyRoom');
        if (el) el.style.display = bShow ? '' : 'none';
        el = get('divRoomListContainer');
        if (el) el.style.display = bShow ? 'none' : '';
        if (bShow) {
            this.showEditGroup(false);
            this.showEditShade(false);
        }
    }
    showEditShade(bShow) {
        let el = get('divLinking');
        if (el) el.remove();
        el = get('divLinkRepeater');
        if (el) el.remove();
        el = get('divPairing');
        if (el) el.remove();
        el = get('divRollingCode');
        if (el) el.remove();
        el = get('somfyShade');
        if (el) el.style.display = bShow ? '' : 'none';
        el = get('divShadeListContainer');
        if (el) el.style.display = bShow ? 'none' : '';
        if (bShow) {
            this.showEditGroup(false);
            this.showEditRoom(false);
        }
    }
    showEditGroup(bShow) {
        let el = get('divLinking');
        if (el) el.remove();
        el = get('divLinkRepeater');
        if (el) el.remove();
        el = get('divPairing');
        if (el) el.remove();
        el = get('divRollingCode');
        if (el) el.remove();
        el = get('somfyGroup');
        if (el) el.style.display = bShow ? '' : 'none';
        el = get('divGroupListContainer');
        if (el) el.style.display = bShow ? 'none' : '';
        if (bShow) {
            this.showEditRoom(false);
            this.showEditShade(false);
        }
    }
    saveRoom() {
        let roomId = parseInt(get('spanRoomId').innerText, 10);
        let obj = ui.fromElement(get('somfyRoom'));
        let valid = true;
        if (valid && (typeof obj.name !== 'string' || obj.name === '' || obj.name.length > 32)) {
            ui.errorMessage(get('divSomfySettings'), tr('ERR_ROOM_NAME_INVALID'));
            valid = false;
        }
        if (valid) {
            if (isNaN(roomId) || roomId === 0) {
                // We are adding.
                putJSONSync('/addRoom', obj, (err, room) => {
                    if (err) {
                        ui.serviceError(err);
                        console.log(err);
                    }
                    else {
                        console.log(room);
                        ui.successMessage(tr('MSG_ADD_SUCCESS'));
                        get('spanRoomId').innerText = room.roomId;
                        get('btnSaveRoom').innerText = tr('BT_SAVE');
                        get('btnSaveRoom').style.display = 'inline-block';
                        this.updateRoomsList();
                    }
                });
            }
            else {
                obj.roomId = roomId;
                putJSONSync('/saveRoom', obj, (err, room) => {
                    if (err) {
                        ui.serviceError(err);
                    } else {
                        ui.successMessage(tr('MSG_SAVE_SUCCESS'));
                        this.updateRoomsList();
                    }
                    console.log(room);
                });
            }
        }
    }
    saveShade() {
        const g = get,
        sId = parseInt(g('spanShadeId').innerText, 10),
        obj = ui.fromElement(g('somfyShade')),
        settings = g('divSomfySettings');

        const checks = [
            [isNaN(obj.remoteAddress) || obj.remoteAddress < 1 || obj.remoteAddress > 16777215, 'ERR_REMOTE_ADDRESS_INVALID'],
            [!obj.name || obj.name.length > 32, 'ERR_DEVIVE_NAME_INVALID'],
            [isNaN(obj.upTime) || obj.upTime < 1 || obj.upTime > 180000, 'ERR_UP_TIME_INVALID'],
            [isNaN(obj.downTime) || obj.downTime < 1 || obj.downTime > 180000, 'ERR_DOWN_TIME_INVALID']
        ];

        const basicError = checks.find(c => c[0]);
        if (basicError) return ui.errorMessage(settings, tr(basicError[1]));

        const conflict = this.findRemoteAddressConflict(obj.remoteAddress, isNaN(sId) ? null : sId, null);
        if (conflict) {
            return ui.errorMessage(settings,
                tr('ERR_REMOTE_ADDRESS_IN_USE').replace('%1', String(obj.remoteAddress)).replace('%2', conflict));
        }
        if (obj.proto === 8 || obj.proto === 9) {
            const isSp = [5, 14, 15, 16, 10].includes(obj.shadeType);

            if (obj.gpioUp === obj.gpioDown && !(isSp && obj.proto === 9)) {
                return ui.errorMessage(settings, tr('ERR_GPIO_UP_DOWN_NOT_UNIQUE'));
            }
            if (!isSp && obj.proto === 9 && (obj.gpioMy === obj.gpioUp || obj.gpioMy === obj.gpioDown)) {
                return ui.errorMessage(settings, tr('ERR_GPIO_UP_DOWN_MY_NOT_UNIQUE'));
            }
        }
        const isNew = isNaN(sId) || sId >= 255;
        if (!isNew) obj.shadeId = sId;
        // Explicit — checkbox bind can be missed if the row was hidden mid-edit.
        if (g('cbExposeAlexa') && g('divExposeAlexa')?.style.display !== 'none')
            obj.exposeAlexa = !!g('cbExposeAlexa').checked;
        // Persist calibrate slider with Save (same 100%=open · 0%=closed scale).
        const cal = g('slidCalibratePos');
        if (!isNew && cal && g('divCalibratePosition')?.style.display !== 'none') {
            const p = parseInt(cal.value, 10);
            if (!isNaN(p) && p >= 0 && p <= 100) obj.position = p;
        }

        putJSONSync(isNew ? '/addShade' : '/saveShade', obj, (err, shade) => {
            if (err) return ui.serviceError(err);

            console.log("Shade saved/added:", shade);
            const msg = isNew ? tr('MSG_ADD_SUCCESS') : tr('MSG_SAVE_SUCCESS');
            ui.successMessage(msg);
            if (shade && typeof shade.exposeAlexa !== 'undefined' && this.shades) {
                const idx = this.shades.findIndex(s => Number(s.shadeId) === Number(shade.shadeId));
                if (idx >= 0) this.shades[idx].exposeAlexa = !!shade.exposeAlexa;
            }
            this.updateShadeList();
            this.openEditShade(shade.shadeId);
        });
    }
    findRemoteAddressConflict(address, excludeShadeId, excludeGroupId) {
        const addr = Number(address);
        if (!addr) return null;
        const shades = this.shades || [];
        for (let i = 0; i < shades.length; i++) {
            const s = shades[i];
            if (!s || Number(s.remoteAddress) !== addr) continue;
            if (excludeShadeId != null && Number(s.shadeId) === Number(excludeShadeId)) continue;
            return s.name || (`device #${s.shadeId}`);
        }
        const groups = this.groups || [];
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            if (!g || Number(g.remoteAddress) !== addr) continue;
            if (excludeGroupId != null && Number(g.groupId) === Number(excludeGroupId)) continue;
            return g.name || (`group #${g.groupId}`);
        }
        return null;
    }
    saveGroup() {
        const g = get,
        sId = g('spanGroupId').innerText,
        groupId = parseInt(sId, 10),
        obj = ui.fromElement(g('somfyGroup')),
        isNew = isNaN(groupId) || groupId >= 255;

        const checks = [
            [isNaN(obj.remoteAddress) || obj.remoteAddress < 1 || obj.remoteAddress > 16777215, 'ERR_REMOTE_ADDRESS_INVALID'],
            [!obj.name || obj.name.length > 32, 'ERR_DEVIVE_NAME_INVALID']
        ];
        const error = checks.find(c => c[0]);
        if (error) return ui.errorMessage(tr(error[1]));
        if (!isNew) obj.groupId = groupId;

        putJSONSync(isNew ? '/addGroup' : '/saveGroup', obj, (err, group) => {
            if (err) return ui.serviceError(err);

            console.log("Group saved:", group);
            const msg = isNew ? tr('MSG_ADD_SUCCESS') : tr('MSG_SAVE_SUCCESS');
            ui.successMessage(msg);
            this.openEditGroup(group.groupId);
            this.updateGroupList();
        });
    }
    updateRoomsList() {
        getJSONSync('/rooms', (err, shades) => {
            if (err) {
                console.log(err);
                ui.serviceError(err);
            }
            else {
                this.setRoomsList(shades);
            }
        });
    }
    updateShadeList() {
        getJSONSync('/shades', (err, shades) => {
            if (err) {
                console.log(err);
                ui.serviceError(err);
            }
            else {
                //console.log(shades);
                // Create the shades list.
                this.setShadesList(shades);
            }
        });
    }
    updateGroupList() {
        getJSONSync('/groups', (err, groups) => {
            if (err) {
                console.log(err);
                ui.serviceError(err);
            }
            else {
                console.log(groups);
                // Create the groups list.
                this.setGroupsList(groups);
            }
        });
    }
    updateRepeatList() {
        getJSONSync('/repeaters', (err, repeaters) => {
            if (err) {
                console.log(err);
                ui.serviceError(err);
            }
            else this.setRepeaterList(repeaters);
        });
    }
    deleteRoom(roomId) {
        let valid = true;
        if (isNaN(roomId) || roomId >= 255 || roomId <= 0) {
            ui.errorMessage(tr('ERR_ROOM_ID_REQUIRED'));
            valid = false;
        }
        if (valid) {
            getJSONSync(`/room?roomId=${roomId}`, (err, room) => {
                if (err) ui.serviceError(err);
                else {
                    let prompt = ui.promptMessage(tr('PROMPT_DELETE_ROOM'), () => {
                        ui.clearErrors();
                        putJSONSync('/deleteRoom', { roomId: roomId }, (err, room) => {
                            prompt.remove();
                            if (err) ui.serviceError(err);
                            else
                                this.updateRoomsList();
                        });
                    });
                    prompt.querySelector('.sub-message').innerHTML = `<p>${tr("PROMPT_DELETE_ROOM_WARNING")}</p>`;
                }
            });
        }
    }
    deleteShade(shadeId) {
        let valid = true;
        if (isNaN(shadeId) || shadeId >= 255 || shadeId <= 0) {
            ui.errorMessage(tr('ERR_DEVICE_ID_REQUIRED'));
            valid = false;
        }
        if (valid) {
            getJSONSync(`/shade?shadeId=${shadeId}`, (err, shade) => {
                if (err) ui.serviceError(err);
                else if (shade.inGroup) ui.errorMessage(tr('ERR_DEVICE_IN_GROUP'));
                else {
                    let prompt = ui.promptMessage(tr('PROMPT_DELETE_SHADE'), () => {
                        ui.clearErrors();
                        putJSONSync('/deleteShade', { shadeId: shadeId }, (err, shade) => {
                            this.updateShadeList();
                            prompt.remove;
                        });
                    });
                    prompt.querySelector('.sub-message').innerHTML = `<p>${tr("PROMPT_DELETE_SHADE_WARNING")}</p><p>${tr("PROMPT_DELETE_SHADE_CONFIRM").replace("{SHADE_NAME}", shade.name)}</p>`;
                }
            });
        }
    }
    deleteGroup(groupId) {
        let valid = true;
        if (isNaN(groupId) || groupId >= 255 || groupId <= 0) {
            ui.errorMessage(tr('ERR_INVALID_GROUP_ID'));
            valid = false;
        }
        if (valid) {
            getJSONSync(`/group?groupId=${groupId}`, (err, group) => {
                if (err) ui.serviceError(err);
                else {
                    if (group.linkedShades.length > 0) {
                        ui.errorMessage(tr('ERR_GROUP_NOT_EMPTY'));
                    }
                    else {
                        let prompt = ui.promptMessage(tr('PROMPT_DELETE_GROUP'), () => {
                            putJSONSync('/deleteGroup', { groupId: groupId }, (err, g) => {
                                if (err) ui.serviceError(err);
                                this.updateGroupList();
                                prompt.remove();
                            });
                        });
                        prompt.querySelector('.sub-message').innerHTML = `<p>${tr("PROMPT_DELETE_GROUP_CONFIRM").replace("{GROUP_NAME}", group.name)}</p>`;
                    }
                }
            });
        }
    }
    sendPairCommand(shadeId) {
        putJSON('/pairShade', { shadeId }, (err, shade) => {
            if (err) return console.log(err);
            console.log(shade);

            get('somfyMain').style.display = 'none';
            get('somfyShade').style.display = '';
            get('btnSaveShade').style.display = 'inline-block';
            get('btnLinkRemote').style.display = '';

            const fields = { shadeAddress: 'remoteAddress', shadeName: 'name', shadeUpTime: 'upTime', shadeDownTime: 'downTime' };
            for (const f in fields) document.getElementsByName(f)[0].value = shade[fields[f]];

            const svg = get('icoShade');
            if (svg) {
                this.applyShadeIconPosition(svg, shade.position, shade.flipPosition, shade.shadeType);
                svg.setAttribute('data-shadeid', shade.shadeId);
            }

            get('btnPairShade').style.display = shade.paired ? 'none' : 'inline-block';
            get('btnUnpairShade').style.display = shade.paired ? 'inline-block' : 'none';

            this.setLinkedRemotesList(shade);
            const divP = qs('divPairing');
            if (divP) divP.remove();
        });
    }
    sendUnpairCommand(shadeId) {
        putJSON('/unpairShade', { shadeId }, (err, shade) => {
            if (err) return console.log(err);
            console.log(shade);

            get('somfyMain').style.display = 'none';
            get('somfyShade').style.display = '';
            get('btnSaveShade').style.display = 'inline-block';
            get('btnLinkRemote').style.display = '';

            const fields = { shadeAddress: 'remoteAddress', shadeName: 'name', shadeUpTime: 'upTime', shadeDownTime: 'downTime' };
            for (const f in fields) document.getElementsByName(f)[0].value = shade[fields[f]];

            const svg = get('icoShade');
            if (svg) {
                this.applyShadeIconPosition(svg, shade.position, shade.flipPosition, shade.shadeType);
                svg.setAttribute('data-shadeid', shade.shadeId);
            }

            get('btnPairShade').style.display = shade.paired ? 'none' : 'inline-block';
            get('btnUnpairShade').style.display = shade.paired ? 'inline-block' : 'none';

            this.setLinkedRemotesList(shade);
            const divP = get('divPairing');
            if (divP) divP.remove();
        });
    }
    setRollingCode(shadeId, rollingCode) {
        putJSONSync('/setRollingCode', { shadeId: shadeId, rollingCode: rollingCode }, (err, shade) => {
            if (err) ui.serviceError(get('divSomfySettings'), err);
            else {
                let dlg = get('divRollingCode');
                if (dlg) dlg.remove();
            }
        });
    }
    openSetRollingCode(shadeId) {
        let overlay = ui.waitMessage(get('divContainer'));
        getJSON(`/shade?shadeId=${shadeId}`, (err, shade) => {
            overlay.remove();
            if (err) return ui.serviceError(err);

            let div = document.createElement('div');
            div.id = 'divRollingCode';
            div.className = 'inst-overlay';

            div.innerHTML = `
            <div class="instructions-content">
            <div class="overlay-scroll-content">
            ${overlayHeader("ROLLING_CODE_TITLE", "ROLLING_CODE_DESC", "svg-warning")}
            <div class="error">
            <svg><use href=#svg-warning></use></svg>
            <div><b>${tr("MSG_DANGER")}</b><span>${tr("ROLLING_CODE_WARNING_DESC_1")}</span></div>
            </div>
            <div class="uniblocStep">${tr("ROLLING_CODE_WARNING_DESC_2")}</div>
            <div class="unibloc uniblocRollingCode">
            <label class="label" for="fldNewRollingCode">${tr("BT_ROLLING_CODE")}</label>
            <input id="fldNewRollingCode" class="inputAndSelect" min="0" max="65535" name="newRollingCode" type="number" value="${shade.lastRollingCode}">
            </div>
            </div>
            <div class="hrDivFooter"></div>
            <div class="button-container-overlay">
            <button id="btnChangeRollingCode" class="bouton-Danger" type="button" onclick="somfy.setRollingCode(${shadeId}, parseInt(get('fldNewRollingCode').value, 10));">${tr("BT_SET_ROLLING_CODE")}</button>
            <button id="btnCancel" line type="button">${tr("BT_CANCEL_1")} </button>
            </div>
            </div>`;

            shOverlay(div);
            div.querySelector('#btnCancel').onclick = () => closeOverlay(div);
            ui.setFocus(btnCancel, true, 'var(--accent-sucess)');
        });
    }
    setPaired(shadeId, paired) {
        let obj = { shadeId: shadeId, paired: paired || false };
        let div = get('divPairing');
        let overlay = typeof div === 'undefined' ? undefined : ui.waitMessage(div);
        putJSONSync('/setPaired', obj, (err, shade) => {
            if (overlay) overlay.remove();
            if (err) {
                console.log(err);
                ui.errorMessage(err.message);
            }
            else if (div) {
                console.log(shade);
                this.showEditShade(true);
                get('btnSaveShade').style.display = 'inline-block';
                get('btnLinkRemote').style.display = '';
                if (shade.paired) {
                    get('btnUnpairShade').style.display = 'inline-block';
                    get('btnPairShade').style.display = 'none';
                    if (get('btnForceUnpairShade')) get('btnForceUnpairShade').style.display = 'none';
                    if (get('divRemoteIdTip')) get('divRemoteIdTip').style.display = 'none';
                }
                else {
                    get('btnPairShade').style.display = 'inline-block';
                    get('btnUnpairShade').style.display = 'none';
                    if (get('btnForceUnpairShade')) get('btnForceUnpairShade').style.display = 'inline-block';
                    if (get('divRemoteIdTip')) get('divRemoteIdTip').style.display = 'block';
                }
                this.setLinkedRemotesList(shade);
                closeOverlay(div);
            }
        });
    }
    _shWiz(shadeId, isUnpair) {
        const sType = parseInt(get('somfyShade').getAttribute('data-shadetype'), 10);
        const isG = (sType === 5 || sType === 6);
        const pre = isUnpair ? 'UNPAIR' : 'PAIR';
        const dev = isG ? 'GARAGE' : 'SHADE';
        const progId = isUnpair ? 'btnSendUnpairing' : 'btnSendPairing';
        const stopId = isUnpair ? 'btnStopUnpairing' : 'btnStopPairing';
        const sucBtnId = isUnpair ? 'btnUnpairShade' : 'btnPairShade';
        const sucVal = isUnpair ? 0 : 1;
        const focusVal = isUnpair ? 1 : 0;
        const sucAction = `somfy.setPaired(${shadeId},${sucVal});ui.setFocus('${sucBtnId}',${focusVal});closeOverlay(get('divPairing'));`;
        const descKey = `${pre}_${dev}_DESC`;
        const stepTitles = ["WIZ_TITLE_STEP1", `${pre}_TITLE_STEP2`, "WIZ_TITLE_STEP3"];
        const t = (s, l) => {
            const sk = `${pre}_${dev}_STEP_${s}_${l}`, fk = `WIZ_${dev}_STEP_${s}_${l}`, r = tr(sk);
            return (r === sk) ? tr(fk) : r;
        };
        const it = (n, s, l) => `<div class="step-item"><div class="step-number">${n}</div><div class="step-text">${t(s, l)}</div></div>`;

        let div = document.createElement('div');
        div.className = `inst-overlay wizard pair-wiz${ui.isExpertMode ? ' is-expert' : ''}`;
        div.id = 'divPairing';
        div.setAttribute('data-stepid', '1');
        div.setAttribute('data-type', 'link-remote');
        div.setAttribute('data-shadeid', shadeId);

        div.innerHTML = `
        <div class="instructions-content pair-wiz-content">
        <div class="overlay-scroll-content">
        <div class="overlay-header"><div class="expert-mode-container"><span class="expert-label">${tr("BT_EXPERT_MODE")}</span><span class="switch expert-switch"><input id="cbExpertMode" type="checkbox" ${ui.isExpertMode ? 'checked' : ''} onchange="ui.toggleExpertMode(this.closest('.inst-overlay'));" onclick="event.stopPropagation();"><div></div></span></div><div close onclick="closeOverlay(this.closest('.inst-overlay'))"><svg class="closeShow-desktop"><use href=#svg-close></use></svg></div></div>
        <div class="pair-wiz-hero">
        <span class="pair-wiz-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href=#${isG ? 'svg-simpleGarage' : 'svg-simpleShutter'}></use></svg></span>
        <div class="pair-wiz-titles">
        <h2>${tr(isUnpair ? 'UNPAIR_TITLE' : 'PAIR_TITLE')}</h2>
        <p>${tr(descKey)}</p>
        </div>
        </div>
        ${wizardStepper(stepTitles)}
        <div class="blocsteps pair-wiz-steps">
        <div class="uniblocStep wizard-step pair-wiz-card" data-stepid="1">
        ${it('1', 1, 1)} ${it('2', 1, 2)} ${isG ? it('3', 1, 3) : ''}
        ${!isG ? `<div class="pair-wiz-note">${t(1, 3)}</div>` : ''}
        </div>
        <div class="button-container-col wizard-step marginB pair-wiz-action" data-expert data-stepid="2">
        <button id="${progId}" type="button" class="pair-wiz-prog">${tr("BT_PROG")}</button>
        <span class="pair-wiz-prog-hint">${t(2, 1)}</span>
        </div>
        <div class="uniblocStep wizard-step pair-wiz-card" data-stepid="2">
        ${it('1', 2, 1)} ${it('2', 2, 2)} ${!isG ? it('3', 2, 3) : ''}
        ${!isG ? `<div class="pair-wiz-note">${t(2, 4)}</div>` : ''}
        </div>
        <div class="button-container-col wizard-step marginB pair-wiz-action" data-expert data-stepid="3">
        <button id="btnWizMarkSuc" type="button" class="btn-success" onclick="${sucAction}">${tr(isUnpair ? "BT_UNPAIRING_SUCCESS" : "BT_PAIRING_SUCCESS")}</button>
        </div>
        <div class="uniblocStep wizard-step pair-wiz-card" data-stepid="3">${it('1', 3, 1)}</div>
        <div class="empty-state wizard-step pair-wiz-done" data-stepid="3"><svg class="empty-icon"><use href=#svg-succes></use></svg></div>
        </div>
        </div>
        <div class="hrDivFooter"></div>
        <div class="expert-only-buttons" data-expert>
        <button type="button" line onclick="closeOverlay(this.closest('.inst-overlay'))">${tr("BT_CANCEL_1")}</button>
        </div>
        <div class="button-container-overlay">
        <button id="${stopId}" class="wizard-step" data-stepid="1" line type="button">${tr("BT_CLOSE")}</button>
        <button id="btnWizPrev" class="wizard-step" data-mstepid="2,3" line type="button" onclick="ui.wizSetPrevStep(this.closest('.wizard'));">${tr("BT_GO_BACK")}</button>
        <button id="btnWizNext" class="wizard-step" data-mstepid="1,2" type="button" onclick="ui.wizSetNextStep(this.closest('.wizard'));">${tr("BT_NEXT")}</button>
        <button id="btnWizEnd" class="wizard-step" data-stepid="3" type="button">${tr(isG ? "BT_CLOSE" : "BT_CANCEL_1")}</button>
        </div>
        </div>`;

        const clearT = () => { if (this.btnTimer) { clearInterval(this.btnTimer); this.btnTimer = null; } };
        const fnRep = (err, shade) => {
            clearT();
            if (!err && mouseDown) somfy.sendCommandRepeat(shadeId, 'prog', null, fnRep);
        };

        let btnProg = div.querySelector(`#${progId}`);
        if (btnProg) {
            const onP = () => somfy.sendCommand(shadeId, 'prog', null, fnRep);
            btnProg.addEventListener('mousedown', onP, true);
            btnProg.addEventListener('touchstart', onP, true);
        }
        div.querySelectorAll(`#${stopId}, #btnWizEnd`).forEach(btn => {
            btn.onclick = () => closeOverlay(div, clearT);
        });

        ui.wizSetStep(div, 1);
        shOverlay(div, clearT);

        return div;
    }
    pairShade(shadeId) {
        return this._shWiz(shadeId, false);
    }

    unpairShade(shadeId) {
        return this._shWiz(shadeId, true);
    }
    _handleCommandAck(err, payload, cb) {
        if (err) {
            ui.serviceError(err);
            if (typeof cb === 'function') cb(err, null);
            return;
        }
        if (typeof cb === 'function') cb(null, payload);
    }
    sendCommand(shadeId, command, repeat, cb) {
        let obj = {};
        if (typeof shadeId.shadeId !== 'undefined') {
            obj = shadeId;
            cb = command;
            shadeId = obj.shadeId;
            repeat = obj.repeat;
            command = obj.command;
        }
        else {
            obj = { shadeId: shadeId };
            if (isNaN(parseInt(command, 10))) obj.command = command;
            else obj.target = parseInt(command, 10);
            if (typeof repeat === 'number') obj.repeat = parseInt(repeat);
        }
        // My while moving must halt — same as HA cover Stop (not favorite).
        if (String(obj.command || '').toLowerCase() === 'my') {
            const el = document.querySelector(`.somfyShadeCtl[data-shadeid="${obj.shadeId}"]`);
            const dir = el ? parseInt(el.getAttribute('data-direction'), 10) : 0;
            const tiltDir = el ? parseInt(el.getAttribute('data-tiltdirection') || '0', 10) : 0;
            if (dir !== 0 || tiltDir !== 0) obj.command = 'stop';
        }
        putJSON('/shadeCommand', obj, (err, shade) => {
            this._handleCommandAck(err, shade, cb);
        });
    }
    sendCommandRepeat(shadeId, command, repeat, cb) {
        //console.log(`Sending Shade command ${shadeId}-${command}`);
        let obj = {};
        if (typeof shadeId.shadeId !== 'undefined') {
            obj = shadeId;
            cb = command;
            shadeId = obj.shadeId;
            repeat = obj.repeat;
            command = obj.command;
        }
        else {
            obj = { shadeId: shadeId, command: command };
            if (typeof repeat === 'number') obj.repeat = parseInt(repeat);
        }
        putJSON('/repeatCommand', obj, (err, shade) => {
            if (typeof cb === 'function') cb(err, shade);
        });
    }
    sendGroupRepeat(groupId, command, repeat, cb) {
        let obj = { groupId: groupId, command: command };
        if (typeof repeat === 'number') obj.repeat = parseInt(repeat);
        putJSON(`/repeatCommand?groupId=${groupId}&command=${command}`, null, (err, group) => {
            if (typeof cb === 'function') cb(err, group);
        });
    }
    sendVRCommand(el) {
        if (typeof mouseDown === 'undefined') window.mouseDown = false;
        let pnl = get('divVirtualRemote');
        let dd = pnl.querySelector('#selVRMotor');
        let opt = dd.selectedOptions[0];
        if (!opt) return;
        let o = {
            type: opt.getAttribute('data-type'),
            address: opt.getAttribute('data-address'),
            cmd: el.getAttribute('data-cmd')
        };
        ui.fromElement(el.parentElement.parentElement, o);
        switch (o.type) {
            case 'shade':
                o.shadeId = parseInt(opt.getAttribute('data-shadeId'), 10);
                o.shadeType = parseInt(opt.getAttribute('data-shadeType'), 10);
                break;
            case 'group':
                o.groupId = parseInt(opt.getAttribute('data-groupId'), 10);
                break;
        }
        console.log(o);
        let fnRepeatCommand = (err, shade) => {
            if (this.btnTimer) {
                clearTimeout(this.btnTimer);
                this.btnTimer = null;
            }
            if (err) return;
            if (mouseDown) {
                if (o.cmd === 'Sensor')
                    somfy.sendSetSensor(o);
                else if (o.type === 'group')
                    somfy.sendGroupRepeat(o.groupId, o.cmd, null, fnRepeatCommand);
                else
                    somfy.sendCommandRepeat(o, fnRepeatCommand);
            }
        }
        o.command = o.cmd;
        if (o.cmd === 'Sensor') {
            somfy.sendSetSensor(o);
        }
        else if (o.type === 'group')
            somfy.sendGroupCommand(o.groupId, o.cmd, null, (err, group) => { fnRepeatCommand(err, group); });
        else
            somfy.sendCommand(o, (err, shade) => { fnRepeatCommand(err, shade); });
    }
    sendRemoteAddressCommand(address, command, bitLength, repeats, cb) {
        const body = {
            address: parseInt(address, 10),
            command: command || 'prog',
            repeats: (typeof repeats === 'number') ? repeats : 1,
            bitLength: bitLength || 56
        };
        putJSON('/sendRemoteCommand', body, (err, res) => {
            if (err) ui.serviceError(err);
            if (typeof cb === 'function') cb(err, res);
        });
    }
    forceUnpairShade(shadeId) {
        const target = (this.shades || []).find(s => Number(s.shadeId) === Number(shadeId));
        if (!target) return ui.errorMessage(tr('ERR_SHADE_ID_REQUIRED'));
        const others = (this.shades || []).filter(s => Number(s.shadeId) !== Number(shadeId));
        if (!others.length) {
            return ui.errorMessage(tr('ERR_FORCE_UNPAIR_NO_HOST'));
        }

        const clearT = () => { if (this.btnTimer) { clearTimeout(this.btnTimer); this.btnTimer = null; } };
        let div = document.createElement('div');
        div.className = `inst-overlay wizard${ui.isExpertMode ? ' is-expert' : ''}`;
        div.id = 'divForceUnpair';
        div.setAttribute('data-stepid', '1');
        div.setAttribute('data-shadeid', shadeId);

        const stepTitles = [
            'FORCE_UNPAIR_TITLE_STEP1',
            'FORCE_UNPAIR_TITLE_STEP2',
            'FORCE_UNPAIR_TITLE_STEP3',
            'FORCE_UNPAIR_TITLE_STEP4'
        ];
        const it = (n, key) => `<div class="step-item"><div class="step-number">${n}</div><div class="step-text">${tr(key)}</div></div>`;
        const inf = (step, key) => `<div class="information wizard-step" data-stepid="${step}"><svg><use href=#svg-info></use></svg><div><b>${tr("MSG_NOTE")}</b><span>${tr(key)}</span></div></div>`;

        div.innerHTML = `
        <div class="instructions-content">
        <div class="overlay-scroll-content">
        ${overlayHeader('FORCE_UNPAIR_TITLE', tr('FORCE_UNPAIR_DESC').replace('%1', String(target.remoteAddress)), 'svg-warning', 1)}
        ${wizardStepper(stepTitles)}
        <div class="blocsteps">
        ${inf(1, 'FORCE_UNPAIR_STEP_1_NOTE')}
        <div class="uniblocStep wizard-step" data-stepid="1">
        ${it('a', 'FORCE_UNPAIR_STEP_1_A')}
        ${it('b', 'FORCE_UNPAIR_STEP_1_B')}
        </div>
        <div class="unibloc wizard-step" data-expert data-stepid="2">
        <label class="label" for="selForceUnpairHost">${tr('FORCE_UNPAIR_SELECT_HOST')}</label>
        <select id="selForceUnpairHost" class="inputAndSelect"></select>
        <div class="uniStatus" style="margin-top:6px;">${tr('FORCE_UNPAIR_SELECT_HOST_HINT').replace('%1', String(target.remoteAddress))}</div>
        </div>
        <div class="uniblocStep wizard-step" data-stepid="2">
        ${it('a', 'FORCE_UNPAIR_STEP_2_A')}
        ${it('b', 'FORCE_UNPAIR_STEP_2_B')}
        </div>
        <div class="blocsteps-row wizard-step" data-expert data-stepid="3">
        <div class="divWizShadeName" id="spanForceHostName"></div>
        <button type="button" id="btnForceOpenMemory">${tr('BT_OPEN_MEMORY')}</button>
        </div>
        <div class="uniblocStep wizard-step" data-stepid="3">
        ${it('a', 'FORCE_UNPAIR_STEP_3_A')}
        ${it('b', 'FORCE_UNPAIR_STEP_3_B')}
        </div>
        ${inf(3, 'FORCE_UNPAIR_STEP_3_NOTE')}
        <div class="blocsteps-row wizard-step" data-expert data-stepid="4">
        <div>${tr('REMOTE_ID')}: <b>${target.remoteAddress}</b></div>
        <button type="button" id="btnForceSendUnpair">${tr('BT_FORCE_UNPAIR_SEND')}</button>
        </div>
        <div class="uniblocStep wizard-step" data-stepid="4">
        ${it('a', 'FORCE_UNPAIR_STEP_4_A')}
        ${it('b', 'FORCE_UNPAIR_STEP_4_B')}
        <div class="empty-state"><svg class="empty-icon"><use href=#svg-succes></use></svg></div>
        </div>
        </div>
        </div>
        <div class="hrDivFooter"></div>
        <div class="expert-only-buttons" data-expert>
        <button type="button" line onclick="closeOverlay(this.closest('.inst-overlay'))">${tr('BT_CANCEL_1')}</button>
        </div>
        <div class="button-container-overlay">
        <button id="btnWizStop" class="wizard-step" data-stepid="1" line type="button">${tr('BT_CANCEL_1')}</button>
        <button id="btnWizPrev" class="wizard-step" data-mstepid="2,3,4" line type="button" onclick="ui.wizSetPrevStep(this.closest('.wizard'));">${tr('BT_GO_BACK')}</button>
        <button id="btnWizNext" class="wizard-step" data-mstepid="1,2,3" type="button" onclick="ui.wizSetNextStep(this.closest('.wizard'));">${tr('BT_NEXT')}</button>
        <button id="btnWizEnd" class="wizard-step" data-stepid="4" type="button">${tr('BT_CLOSE')}</button>
        </div>
        </div>`;

        const sel = div.querySelector('#selForceUnpairHost');
        others.forEach(s => {
            const opt = new Option(`${s.name} (ID ${s.remoteAddress})`, s.shadeId);
            opt.setAttribute('data-bitlength', s.bitLength || 56);
            sel.options.add(opt);
        });
        const syncHostName = () => {
            const o = sel.options[sel.selectedIndex];
            div.querySelectorAll('#spanForceHostName, .divWizShadeName').forEach(el => {
                if (el) el.textContent = o ? o.text : '';
            });
        };
        sel.onchange = syncHostName;
        syncHostName();

        div.querySelectorAll('#btnWizStop, #btnWizEnd').forEach(btn => {
            btn.onclick = () => closeOverlay(div, clearT);
        });

        div.querySelector('#btnForceOpenMemory').onclick = () => {
            const hostId = parseInt(sel.value, 10);
            putJSONSync('/shadeCommand', { shadeId: hostId, command: 'prog', repeat: 40 }, (err) => {
                if (err) return ui.serviceError(err);
                let prompt = ui.promptMessage(tr('PROMPT_CONFIRM_MOTOR_RESPONSE'), () => {
                    ui.wizSetNextStep(div);
                    closeOverlay(prompt);
                });
                prompt.querySelector('.sub-message').innerHTML =
                    `<p>${tr('PROMPT_SHADE_MOVE_CONFIRM')}</p><p>${tr('FORCE_UNPAIR_MEMORY_READY')}</p>`;
            });
        };

        div.querySelector('#btnForceSendUnpair').onclick = () => {
            const bit = target.bitLength || 56;
            const repeats = (Number(bit) === 56) ? 7 : 1;
            // Transmit THIS shade's Remote ID (e.g. 872484), not the host motor's ID.
            this.sendRemoteAddressCommand(target.remoteAddress, 'prog', bit, repeats, (err) => {
                if (err) return;
                let prompt = ui.promptMessage(tr('PROMPT_CONFIRM_MOTOR_RESPONSE'), () => {
                    putJSONSync('/setPaired', { shadeId: shadeId, paired: false }, () => {});
                    closeOverlay(prompt);
                    closeOverlay(div, clearT);
                    ui.successMessage(tr('MSG_FORCE_UNPAIR_DONE'));
                    this.openEditShade(shadeId);
                });
                prompt.querySelector('.sub-message').innerHTML =
                    `<p>${tr('PROMPT_SHADE_MOVE_CONFIRM')}</p><p>${tr('FORCE_UNPAIR_LINK_DONE')}</p>`;
            });
        };

        ui.wizSetStep(div, 1);
        shOverlay(div, clearT);
        return div;
    }
    sendSetSensor(obj, cb) {
        putJSON('/setSensor', obj, (err, device) => {
            if (typeof cb === 'function') cb(err, device);
        });
    }
    sendGroupCommand(groupId, command, repeat, cb, rf) {
        let obj = { groupId: groupId };
        if (isNaN(parseInt(command, 10))) obj.command = command;
        if (typeof repeat === 'number') obj.repeat = parseInt(repeat);
        if (rf) {
            if (rf.bitLength) obj.bitLength = rf.bitLength;
            if (typeof rf.proto !== 'undefined') obj.proto = rf.proto;
        }
        // My while group is moving → stop (never favorite mid-travel).
        if (String(obj.command || '').toLowerCase() === 'my') {
            const el = document.querySelector(`.somfyGroupCtl[data-groupid="${groupId}"]`);
            const dir = el ? parseInt(el.getAttribute('data-direction') || '0', 10) : 0;
            if (dir !== 0) obj.command = 'stop';
        }
        putJSON('/groupCommand', obj, (err, group) => {
            this._handleCommandAck(err, group, cb);
        });
    }
    sendTiltCommand(shadeId, command, cb) {
        console.log(`Sending Tilt command ${shadeId}-${command}`);
        if (isNaN(parseInt(command, 10)))
            putJSON('/tiltCommand', { shadeId: shadeId, command: command }, (err, shade) => {
                if (typeof cb === 'function') cb(err, shade);
            });
                else
                    putJSON('/tiltCommand', { shadeId: shadeId, target: parseInt(command, 10) }, (err, shade) => {
                        if (typeof cb === 'function') cb(err, shade);
                    });
    }
    linkRemote(shadeId) {
        let div = document.createElement('div');
        div.className = 'inst-overlay';
        div.id = 'divLinking';
        div.setAttribute('data-type', 'link-remote');
        div.setAttribute('data-shadeid', shadeId);

        div.innerHTML = `
        <div class="instructions-content">
        <div class="overlay-scroll-content">
        ${overlayHeader("PAIR_TITLE", "LINK_REMOTE_DESC", "svg-remote")}
        <div class="uniblocStep">${tr("LINK_REMOTE_DESC_1")}</div>
        <div class="information">
        <svg><use href=#svg-info></use></svg>
        <div><b>${tr("MSG_NOTE")}</b><span>${tr("LINK_REMOTE_DESC_2")}</span></div>
        </div>
        </div>
        <div class="hrDivFooter"></div>
        <div class="button-container-overlay">
        <button id="btnStopLink" line type="button">${tr("BT_CANCEL_1")}</button>
        </div>
        </div>
        </div>`;

        shOverlay(div);
        div.querySelector('#btnStopLink').onclick = () => closeOverlay(div);

        return div;
    }
    linkRepeatRemote() {
        let div = document.createElement('div');
        div.className = 'inst-overlay';
        div.id = 'divLinkRepeater';
        div.setAttribute('data-type', 'link-repeatremote');

        div.innerHTML = `
        <div class="instructions-content">

        <div class="overlay-scroll-content">
        ${overlayHeader("REPEAT_REMOTE_TITLE", "REPEAT_REMOTE_DESC", "svg-repeater")}
        <div class="warning">
        <svg><use href=#svg-warning></use></svg>
        <div>
        <b>${tr("MSG_ALERT")}</b>
        <span>${tr("REPEAT_REMOTE_DESC_4")}<br><br>${tr("REPEAT_REMOTE_DESC_3")}</span>
        </div>
        </div>
        <div class="uniblocStep">
        <div class="step-item"><div class="step-number">a</div><div class="step-text">${tr("REPEAT_REMOTE_DESC_1")}</div></div>
        <div class="step-item"><div class="step-number">b</div><div class="step-text">${tr("REPEAT_REMOTE_DESC_2")}</div></div>
        <div class="step-item"><div class="step-number">c</div><div class="step-text">${tr("REPEAT_REMOTE_DESC_5")}</div></div>
        </div>
        </div>
        <div class="hrDivFooter"></div>
        <div class="button-container-overlay">
        <button id="btnStopLinking" type="button" line>${tr("BT_CANCEL_1")}</button>
        </div>
        </div>`;

        div.querySelector('#btnStopLinking').onclick = () => closeOverlay(div);
        shOverlay(div);

        return div;
    }
    _gpWiz(groupId, isUnlink, shadeId = null) {
        const pre = isUnlink ? 'UNLINK' : 'LINK';
        const stepsCount = isUnlink ? 3 : 4;
        const btnActionId = isUnlink ? 'btnUnpairFromGroup' : 'btnPairToGroup';
        const titleKey = `${pre}_GROUP_TITLE`;
        const descKey = `${pre}_GROUP_DESC`;
        const t = (s, l) => {
            const sk = `${pre}_GROUP_STEP_${s}_${l}`;
            const fk = `WIZ_LINK_GROUP_STEP_${s}_${l}`;
            const r = tr(sk);
            return (r === sk) ? tr(fk) : r;
        };
        const it = (n, s, l) => `<div class="step-item"><div class="step-number">${n}</div><div class="step-text">${t(s, l)}</div></div>`;
        const inf = (s, l) => `<div class="information wizard-step" data-stepid="${s}"><svg><use href=#svg-info></use></svg><div><b>${tr("MSG_NOTE")}</b><span>${t(s, l)}</span></div></div>`;

        let div = document.createElement('div');
        div.className = `inst-overlay wizard${ui.isExpertMode ? ' is-expert' : ''}`;
        div.id = isUnlink ? 'divUnlinkGroup' : 'divLinkGroup';
        div.setAttribute('data-groupid', groupId);
        div.setAttribute('data-stepid', '1');

        const stepTitles = [];
        for (let i = 1; i <= stepsCount; i++) {
            let titleIndex = i;
            if (isUnlink && i === 2) titleIndex = 3;
            if (isUnlink && i === 3) titleIndex = 3;

            let tk = `WIZ_LINK_GROUP_TITLE_STEP${titleIndex}`;
            if (tr(tk) === tk || (isUnlink && i === 3) || (!isUnlink && i === 2) || (!isUnlink && i === 4)) {
                tk = `${pre}_GROUP_TITLE_STEP${isUnlink && i === 3 ? '_3' : titleIndex}`;
            }
            stepTitles.push(tk);
        }

        div.innerHTML = `
        <div class="instructions-content">
        <div class="overlay-scroll-content">
        ${overlayHeader(titleKey, tr(descKey), "svg-simpleShutter", 1)}
        ${wizardStepper(stepTitles)}
        <div class="blocGroupsteps">
        ${inf(1, 1)}
        <div class="uniblocStep wizard-step" data-stepid="1">
        ${it('a', 1, 2)} ${it('c', 1, 3)}
        </div>
        ${!isUnlink ? `
        <div class="unibloc LinkGroupSelect wizard-step" data-expert data-stepid="2">
        <label class="label" for="selAvailShades">${tr("LINK_GROUP_SELECT_SHADE")}</label>
        <select id="selAvailShades" class="inputAndSelect" data-bind="shadeId" onchange="document.querySelectorAll('.divWizShadeName').forEach(el => el.innerHTML = this.options[this.selectedIndex].text);"></select>
        </div>
        <div class="uniblocStep wizard-step" data-stepid="2">
        ${it('a', 2, 1)} ${it('b', 2, 2)}
        </div>
        ${inf(2, 3)}
        ` : ''}
        <div class="blocsteps-row wizard-step" data-expert data-stepid="${isUnlink ? 2 : 3}">
        <div class="divWizShadeName"></div>
        <button type="button" id="btnOpenMemory">${tr("BT_OPEN_MEMORY")}</button>
        </div>
        <div class="uniblocStep wizard-step" data-stepid="${isUnlink ? 2 : 3}">
        ${it('a', isUnlink ? 2 : 3, 1)}
        ${it('b', isUnlink ? 2 : 3, 2)}
        </div>
        ${isUnlink ? inf(2, 3) : inf(3, 3)}
        <div class="blocsteps-row wizard-step" data-expert data-stepid="${isUnlink ? 3 : 4}">
        <div class="divWizShadeName"></div>
        <button id="${btnActionId}" type="button">${tr(isUnlink ? "BT_UNPAIR_GROUP" : "BT_PAIR_TO_GROUP")}</button>
        </div>
        <div class="uniblocStep wizard-step" data-stepid="${isUnlink ? 3 : 4}">
        ${it('a', isUnlink ? 3 : 4, 1)}
        ${it('b', isUnlink ? 3 : 4, 2)}
        <div class="empty-state"><svg class="empty-icon"><use href=#svg-succes></use></svg></div>
        </div>
        </div>
        </div>
        <div class="hrDivFooter"></div>
        <div class="expert-only-buttons" data-expert>
        <button type="button" line onclick="closeOverlay(this.closest('.inst-overlay'))">${tr("BT_CANCEL_1")}</button>
        </div>
        <div class="button-container-overlay">
        <button id="btnWizStop" class="wizard-step" data-stepid="1" line type="button">${tr("BT_CANCEL_1")}</button>
        <button id="btnWizPrev" class="wizard-step" data-mstepid="${isUnlink ? '2,3' : '2,3,4'}" line type="button" onclick="ui.wizSetPrevStep(this.closest('.wizard'));">${tr("BT_GO_BACK")}</button>
        <button id="btnWizNext" class="wizard-step" data-mstepid="${isUnlink ? '1,2' : '1,2,3'}" type="button" onclick="ui.wizSetNextStep(this.closest('.wizard'));">${tr("BT_NEXT")}</button>
        <button id="btnWizEnd" class="wizard-step" data-stepid="${stepsCount}" type="button">${tr("BT_CANCEL_1")}</button>
        </div>
        </div>`;

        const clearT = () => { if (this.btnTimer) { clearTimeout(this.btnTimer); this.btnTimer = null; } };

        div.querySelectorAll('#btnWizStop, #btnWizEnd').forEach(btn => btn.onclick = () => closeOverlay(div, clearT));

        const hP = div.querySelector('.instructions-header p');
        if (hP) hP.innerHTML += ' <span id="spanGroupName" class="groupNameSpan"></span>';

        // Pair PROG uses the group remote address. Pass the selected shade's RF mode
        // as a one-shot override (do not rewrite the saved group settings).
        let wizGroup = null;
        let wizAvail = [];
        let wizLinked = [];
        let wizPairRf = null;
        const selectedShadeId = () => {
            if (isUnlink) return shadeId;
            const sel = div.querySelector('#selAvailShades');
            if (sel && sel.value !== '') return parseInt(sel.value, 10);
            const v = ui.fromElement(div).shadeId;
            return v !== undefined && v !== null && v !== '' ? parseInt(v, 10) : NaN;
        };
        const findShadeMeta = (id) => {
            const sid = Number(id);
            return wizAvail.find(s => Number(s.shadeId) === sid)
                || wizLinked.find(s => Number(s.shadeId) === sid)
                || null;
        };
        const rfForShade = (sId) => {
            const shade = findShadeMeta(sId);
            if (!shade) return null;
            return {
                bitLength: shade.bitLength || 56,
                proto: (typeof shade.proto !== 'undefined') ? shade.proto : 0
            };
        };

        div.querySelector('#btnOpenMemory').onclick = () => {
            const sId = selectedShadeId();
            if (Number.isNaN(sId)) {
                ui.errorMessage(tr('MSG_ALERT')).querySelector('.sub-message').innerHTML = tr('LINK_GROUP_SELECT_SHADE');
                return;
            }
            putJSONSync('/shadeCommand', { shadeId: sId, command: 'prog', repeat: 40 }, (err) => {
                if (err) ui.serviceError(err);
                else {
                    let prompt = ui.promptMessage(tr('PROMPT_CONFIRM_MOTOR_RESPONSE'), () => {
                        ui.wizSetNextStep(div);
                        closeOverlay(prompt);
                    });
                    prompt.querySelector('.sub-message').innerHTML = isUnlink ?
                    `<hr><p>${tr("PROMPT_SHADE_MOVE_CONFIRM")}</p><p>${tr("UNLINK_GROUP_METHOD_1")}</p>` :
                    `<p>${tr("PROMPT_SHADE_MOVE_CONFIRM")}</p><p>${tr("LINK_GROUP_MEMORY_READY_FOR_GROUP")}</p>`;
                }
            });
        };
        const btnAction = div.querySelector(`#${btnActionId}`);
        let fnRepeat = (err, o) => {
            clearT();
            if (!err && mouseDown) {
                if (o.cmd === 'Sensor') somfy.sendSetSensor(o);
                else if (o.groupId !== undefined) somfy.sendGroupRepeat(o.groupId, 'prog', null, fnRepeat);
                else somfy.sendCommandRepeat(o.shadeId, 'prog', null, fnRepeat);
            }
        };
        if (isUnlink) {
            btnAction.onclick = () => {
                const rf = rfForShade(shadeId);
                const body = { groupId: groupId, command: 'prog', repeat: 1 };
                if (rf) { body.bitLength = rf.bitLength; body.proto = rf.proto; }
                putJSONSync('/groupCommand', body, (err) => {
                    if (err) ui.serviceError(err);
                    else {
                        let prompt = ui.promptMessage(tr('PROMPT_CONFIRM_MOTOR_RESPONSE'), () => {
                            putJSONSync('/unlinkFromGroup', { groupId: groupId, shadeId: shadeId }, (err, group) => {
                                somfy.setLinkedShadesList(group);
                                this.updateGroupList();
                            });
                            closeOverlay(prompt);
                            closeOverlay(div, clearT);
                        });
                        prompt.querySelector('.sub-message').innerHTML = `<hr><p>${tr("PROMPT_SHADE_MOVE_CONFIRM")}</p><p>${tr("PROMPT_SHADE_MOVE_DONE")}</p>`;
                    }
                });
            };
        } else {
            btnAction.onmousedown = () => {
                const sId = selectedShadeId();
                mouseDown = true;
                wizPairRf = rfForShade(sId);
                somfy.sendGroupCommand(groupId, 'prog', null, fnRepeat, wizPairRf);
            };
            btnAction.onmouseup = () => {
                mouseDown = false;
                const sId = selectedShadeId();
                let prompt = ui.promptMessage(tr('PROMPT_CONFIRM_MOTOR_RESPONSE'), () => {
                    putJSONSync('/linkToGroup', { groupId: groupId, shadeId: sId }, (err, group) => {
                        somfy.setLinkedShadesList(group);
                        this.updateGroupList();
                    });
                    closeOverlay(prompt);
                    closeOverlay(div, clearT);
                });
                prompt.querySelector('.sub-message').innerHTML = `<p>${tr("PROMPT_SHADE_GROUP_LINK_CONFIRM")}</p><p>${tr("LINK_GROUP_LINK_DONE")}</p>`;
            };
        }
        const urlInit = isUnlink ? `/group?groupId=${groupId}` : `/groupOptions?groupId=${groupId}`;
        getJSONSync(urlInit, (err, data) => {
            if (err) {
                ui.serviceError(err);
                return;
            }
            let canShow = false;
            const spanName = div.querySelector('#spanGroupName');
            wizGroup = data;
            wizLinked = data.linkedShades || [];

            if (isUnlink) {
                const shade = (data.linkedShades || []).find(x => Number(x.shadeId) === Number(shadeId));
                if (shade) {
                    if (spanName) spanName.innerHTML = data.name;
                    div.querySelectorAll('.divWizShadeName').forEach(el => el.innerHTML = shade.name);
                    canShow = true;
                } else {
                    ui.errorMessage(tr('ERR_DEVICE_NOT_FOUND_GROUP'));
                }
            } else {
                if (data.availShades && data.availShades.length > 0) {
                    wizAvail = data.availShades;
                    if (spanName) spanName.innerHTML = data.name;
                    let selAvail = div.querySelector('#selAvailShades');
                    data.availShades.forEach(s => {
                        const opt = new Option(s.name, s.shadeId);
                        opt.setAttribute('data-bitlength', s.bitLength);
                        opt.setAttribute('data-proto', s.proto);
                        selAvail.options.add(opt);
                    });
                    div.querySelectorAll('.divWizShadeName').forEach(el => el.innerHTML = data.availShades[0].name);
                    canShow = true;
                } else {
                    ui.errorMessage(tr('ERR_NO_DEVICE_AVAILABLE_GROUP'));
                }
            }
            if (canShow) {
                ui.wizSetStep(div, 1);
                shOverlay(div, clearT);
            }
        });
        return div;
    }
    linkGroupShade(groupId) { return this._gpWiz(groupId, false); }
    unlinkGroupShade(groupId, shadeId) { return this._gpWiz(groupId, true, shadeId); }

    unlinkRepeater(address) {
        let prompt = ui.promptMessage(tr('PROMPT_UNLINK_REPEATER'), () => {
            putJSONSync('/unlinkRepeater', { address: address }, (err, repeaters) => {
                if (err) ui.serviceError(err);
                else this.setRepeaterList(repeaters);
                prompt.remove();
            });
        });
    }
    unlinkRemote(shadeId, remoteAddress) {
        let prompt = ui.promptMessage(tr('PROMPT_UNLINK_REMOTE'), () => {
            let obj = {
                shadeId: shadeId,
                remoteAddress: remoteAddress
            };
            putJSONSync('/unlinkRemote', obj, (err, shade) => {

                console.log(shade);
                prompt.remove();
                this.setLinkedRemotesList(shade);
            });
        });
    }
    deviationChanged(el) {
        get('spanDeviation').innerText = (el.value / 100).fmt('#,##0.00');
    }
    rxBandwidthChanged(el) {
        get('spanRxBandwidth').innerText = (el.value / 100).fmt('#,##0.00');
    }
    frequencyChanged(el) {
        get('spanFrequency').innerText = (el.value / 1000).fmt('#,##0.000');
    }
    txPowerChanged(el) {
        console.log(el.value);
        let lvls = [-30, -20, -15, -10, -6, 0, 5, 7, 10, 11, 12];
        get('spanTxPower').innerText = lvls[el.value];
    }
    stepSizeChanged(el) {
        get('spanStepSize').innerText = parseInt(el.value, 10).fmt('#,##0');
    }
    processShadeTarget(el, shadeId) {
        let positioner = document.querySelector(`.shade-positioner[data-shadeid="${shadeId}"]`);
        if (positioner) {
            positioner.querySelector(`.shade-target`).innerHTML = el.value;
            somfy.sendCommand(shadeId, el.value);
        }
    }
    processShadeTiltTarget(el, shadeId) {
        let positioner = document.querySelector(`.shade-positioner[data-shadeid="${shadeId}"]`);
        if (positioner) {
            positioner.querySelector(`.shade-tilt-target`).innerHTML = el.value;
            somfy.sendTiltCommand(shadeId, el.value);
        }
    }
    openSelectRoom() {
        this.closeShadePositioners();
        console.log('Opening rooms');
        let list = get('divRoomSelector-list');
        list.style.display = 'block';
        document.body.addEventListener('click', () => {
            list.style.display = '';
        }, { once: true });
    }
    openSetPosition(shadeId) {
        console.log('Opening Shade Positioner');
        if (typeof shadeId === 'undefined') return;

        let shade = document.querySelector(`div.somfyShadeCtl[data-shadeid="${shadeId}"]`);
        if (!shade) return;

        let existing = shade.querySelector('.shade-positioner');
        if (existing) {
            this.dismissPositioners();
            return;
        }
        this.dismissPositioners(false);
        if (!this.canSetPosition(shade.getAttribute('data-shadetype'))) return;

        let tiltType = parseInt(shade.getAttribute('data-tilt'), 10) || 0;
        let currPos = parseInt(shade.getAttribute('data-target'), 10) || 0;
        let currTiltPos = parseInt(shade.getAttribute('data-tilttarget'), 10) || 0;
        const myPos = parseInt(shade.getAttribute('data-mypos'), 10);
        const scaleHint = tr('POPUP_POS_SCALE') || '100% open · 0% closed';

        const positionSlider = (tiltType !== 3) ? `
        <div class="slider-group">
        <div class="slider-header">
        <span class="title">${tr('POPUP_TARGET_POSITION')}</span>
        <span class="val"><span id="spanShadeTarget" class="shade-target">${currPos}</span>%</span>
        </div>
        <div class="uniStatus pos-scale-hint">${scaleHint}</div>
        <input id="slidShadeTarget" name="shadeTarget" type="range" min="0" max="100" step="1" value="${currPos}" onchange="somfy.processShadeTarget(this, ${shadeId});" oninput="get('spanShadeTarget').innerHTML = this.value;" />
        </div>` : '';

        const tiltSlider = (tiltType > 0) ? `
        <div class="slider-group">
        <div class="slider-header">
        <span class="title">${tr('POPUP_TARGET_TILT_POSITION')}</span>
        <span class="val"><span id="spanShadeTiltTarget" class="shade-tilt-target">${currTiltPos}</span>%</span>
        </div>
        <div class="uniStatus pos-scale-hint">${scaleHint}</div>
        <input id="slidShadeTiltTarget" name="shadeTarget" type="range" min="0" max="100" step="1" value="${currTiltPos}" onchange="somfy.processShadeTiltTarget(this, ${shadeId});" oninput="get('spanShadeTiltTarget').innerHTML = this.value;" />
        </div>` : '';

        let div = document.createElement('div');
        div.setAttribute('class', 'shade-positioner shade-positioner-popup');
        div.setAttribute('data-shadeid', shadeId);
        div.onclick = (event) => { event.stopPropagation(); };

        div.innerHTML = `
        <div class="shade-positioner-inner">
        <button type="button" class="pos-close" aria-label="${tr('BT_CANCEL_1') || 'Close'}"><svg class="icon-svg"><use href="#svg-close"></use></svg></button>
        ${positionSlider}
        ${tiltSlider}
        ${myPos >= 0 ? `<div class="popup-actions"><button type="button" id="btnGoMy">${tr('HOME_GO_MY') || 'Go to My'}</button></div>` : ''}
        </div>`;

        shade.appendChild(div);
        const elClose = div.querySelector('.pos-close');
        if (elClose) elClose.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.dismissPositioners(); };
        const elGoMy = div.querySelector('#btnGoMy');
        if (elGoMy) elGoMy.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.dismissPositioners(); this.sendCommand(shadeId, 'my'); };

        document.body.addEventListener('click', () => this.dismissPositioners(), { once: true });
    }
}
var somfy = new Somfy();
class MQTT {
    initialized = false;
    init() { this.initialized = true; }
    async loadMQTT() {
        getJSONSync('/mqttsettings', (err, settings) => {
            if (err)
                console.log(err);
            else {
                console.log(settings);
                ui.toElement(get('divMQTT'), { mqtt: settings });
                get('divDiscoveryTopic').style.display = settings.pubDisco ? '' : 'none';
                get('hrIdDiscoveryTopic').style.display = settings.pubDisco ? '' : 'none';
            }
        });
    }
    connectMQTT() {
        let obj = ui.fromElement(get('divMQTT'));
        console.log(obj);
        if (obj.mqtt.enabled) {
            if (typeof obj.mqtt.hostname !== 'string' || obj.mqtt.hostname.length === 0) {
                ui.errorMessage (tr('ERR_HOSTNAME')).querySelector('.sub-message').innerHTML = tr('ERR_MQTT_HOSTNAME_REQUIRED');
                return;
            }
            if (obj.mqtt.hostname.length > 64) {
                ui.errorMessage (tr('ERR_HOSTNAME')).querySelector('.sub-message').innerHTML = tr('ERR_HOSTNAME_MAX_LENGTH_64');
                return;
            }
            if (isNaN(obj.mqtt.port) || obj.mqtt.port < 0) {
                ui.errorMessage (tr('ERR_PORT_INVALID')).querySelector('.sub-message').innerHTML = tr('ERR_MQTT_PORT_HINT');
                return;
            }
            if (typeof obj.mqtt.username === 'string' && obj.mqtt.username.length > 32) {
                ui.errorMessage (tr('ERR_USERNAME_INVALID')).querySelector('.sub-message').innerHTML = tr('ERR_USERNAME_MAX_LENGTH_32');
                return;
            }
            if (typeof obj.mqtt.password === 'string' && obj.mqtt.password.length > 32) {
                ui.errorMessage (tr('ERR_PASSWORD_INVALID')).querySelector('.sub-message').innerHTML = tr('ERR_PASSWORD_MAX_LENGTH_32');
                return;
            }
            if (typeof obj.mqtt.rootTopic === 'string' && obj.mqtt.rootTopic.length > 64) {
                ui.errorMessage (tr('ERR_ROOT_TOPIC_INVALID')).querySelector('.sub-message').innerHTML = tr('ERR_ROOT_TOPIC_MAX_LENGTH_64');
                return;
            }
        }
        putJSONSync('/connectmqtt', obj.mqtt, (err, response) => {
            if (err) {
                ui.serviceError(err);
            } else {
                ui.successMessage(tr('MSG_SAVE_SUCCESS'));
                console.log(response);
            }
        });
    }
}
var mqtt = new MQTT();
class AlexaPage {
    maxDevices = 24;
    enabled = false;
    loadPage() {
        getJSONSync('/modulesettings', (err2, settings) => {
            if (!err2 && settings) {
                this.enabled = !!settings.alexaHueEnabled;
                if (typeof settings.alexaHueMax === 'number') this.maxDevices = settings.alexaHueMax;
                if (typeof general !== 'undefined') general.general = Object.assign(general.general || {}, settings);
                const cb = get('cbAlexaHueEnabled');
                if (cb) cb.checked = this.enabled;
            }
            // Always refresh shades so device-editor toggles and this page stay in sync.
            getJSONSync('/shades', (err, shades) => {
                if (!err && Array.isArray(shades) && typeof somfy !== 'undefined')
                    somfy.shades = shades;
                this.renderList();
            });
        });
    }
    setEnabled(on) {
        putJSONSync('/setgeneral', { alexaHueEnabled: !!on }, (err) => {
            if (err) return ui.serviceError(err);
            this.enabled = !!on;
            if (typeof general !== 'undefined' && general.general)
                general.general.alexaHueEnabled = this.enabled;
            this.refreshCount();
        });
    }
    refreshCount() {
        const el = get('spanAlexaHueCount');
        if (!el) return;
        const n = (somfy.shades || []).filter(s => s && s.exposeAlexa).length;
        const max = this.maxDevices || 24;
        el.textContent = (typeof tr === 'function' ? tr('ALEXA_HUE_COUNT') : 'Alexa lights: %1 / %2')
            .replace('%1', String(n)).replace('%2', String(max));
        if (typeof general !== 'undefined' && general.general) {
            general.general.alexaHueCount = n;
            general.general.alexaHueMax = max;
        }
    }
    canExposeMore() {
        const n = (somfy.shades || []).filter(s => s && s.exposeAlexa).length;
        return n < (this.maxDevices || 24);
    }
    eligibleShade(s) {
        if (!s || s.shadeId == null || Number(s.shadeId) >= 255) return false;
        const t = parseInt(s.shadeType != null ? s.shadeType : s.type, 10);
        if (Number.isNaN(t)) return true;
        return t !== 9 && t !== 10;
    }
    shadeLabel(s) {
        return s.name || (`#${s.shadeId}`);
    }
    shadeRoom(s) {
        const rooms = (typeof _rooms !== 'undefined' && _rooms.length) ? _rooms
            : ((typeof somfy !== 'undefined' && somfy.rooms) ? somfy.rooms : []);
        const room = rooms.find(r => Number(r.roomId) === Number(s.roomId));
        return (room && room.name) ? room.name : '';
    }
    allEligible() {
        return (somfy.shades || []).filter(s => this.eligibleShade(s))
            .slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }
    applyLocalExpose(shadeId, want) {
        const id = Number(shadeId);
        const list = somfy.shades || [];
        for (let i = 0; i < list.length; i++) {
            if (Number(list[i].shadeId) === id) {
                list[i].exposeAlexa = want;
                return;
            }
        }
    }
    renderList() {
        const list = get('divAlexaShadeList');
        const empty = get('divAlexaShadeEmpty');
        if (!list) return;

        const eligible = this.allEligible();
        const atCap = !this.canExposeMore();
        list.innerHTML = '';

        eligible.forEach(s => {
            const on = !!s.exposeAlexa;
            const room = this.shadeRoom(s);
            const row = document.createElement('label');
            row.className = 'uniRow alexa-shade-row' + (on ? ' is-on-alexa' : '');
            row.innerHTML = `
                <div class="uniText">
                    <div class="uniLabel"></div>
                    <div class="uniStatus"></div>
                </div>
                <div class="uniRight">
                    <span class="switch">
                        <input type="checkbox"${on ? ' checked' : ''}${(!on && atCap) ? ' disabled' : ''}/>
                        <div></div>
                    </span>
                </div>`;
            row.querySelector('.uniLabel').textContent = this.shadeLabel(s);
            const status = on
                ? (tr('ALEXA_STATUS_ON') || 'On Alexa')
                : (tr('ALEXA_STATUS_OFF') || 'Not on Alexa');
            row.querySelector('.uniStatus').textContent = room ? `${room} · ${status}` : status;
            const cb = row.querySelector('input');
            cb.addEventListener('change', () => {
                const want = !!cb.checked;
                if (want && !this.canExposeMore()) {
                    cb.checked = false;
                    return ui.errorMessage(get('divAlexa') || document.body,
                        (tr('ALEXA_AT_CAP') || 'Alexa limit reached (%1).').replace('%1', String(this.maxDevices)));
                }
                this.setShadeExpose(s.shadeId, want, cb);
            });
            list.appendChild(row);
        });

        if (empty) empty.style.display = eligible.length ? 'none' : '';
        this.refreshCount();
    }
    setShadeExpose(shadeId, expose, cbEl) {
        const want = !!expose;
        if (want && !this.canExposeMore()) {
            if (cbEl) cbEl.checked = false;
            return ui.errorMessage(get('divAlexa') || document.body,
                (tr('ALEXA_AT_CAP') || 'Alexa limit reached (%1).').replace('%1', String(this.maxDevices)));
        }
        putJSONSync('/saveShade', { shadeId: Number(shadeId), exposeAlexa: want }, (err, shade) => {
            if (err) {
                if (cbEl) cbEl.checked = !want;
                return ui.serviceError(err);
            }
            this.applyLocalExpose(shadeId, want);
            if (shade && typeof shade === 'object') {
                const idx = (somfy.shades || []).findIndex(s => Number(s.shadeId) === Number(shadeId));
                if (idx >= 0) {
                    somfy.shades[idx] = Object.assign(somfy.shades[idx], shade);
                    somfy.shades[idx].exposeAlexa = want;
                }
            }
            this.renderList();
        });
    }
}
var alexa = new AlexaPage();
class Firmware {
    initialized = false;
    _updateBusy = false;
    _busyGuard = null;
    init() { this.initialized = true; }
    isUpdateBusy() { return !!this._updateBusy; }
    setUpdateBusy(busy) {
        const on = !!busy;
        this._updateBusy = on;
        document.documentElement.classList.toggle('fw-update-busy', on);
        const lockClose = (root) => {
            if (!root) return;
            root.classList.toggle('fw-update-locked', on);
            root.querySelectorAll('[close]').forEach(el => {
                el.style.pointerEvents = on ? 'none' : '';
                el.style.opacity = on ? '0.35' : '';
                el.style.cursor = on ? 'not-allowed' : '';
            });
        };
        lockClose(get('divUploadFile'));
        lockClose(get('divGitInstall'));
        if (on && !this._busyGuard) {
            this._busyGuard = (e) => {
                const root = get('divUploadFile') || get('divGitInstall');
                if (!root) return;
                if (root.contains(e.target)) return;
                e.preventDefault();
                e.stopPropagation();
            };
            document.addEventListener('click', this._busyGuard, true);
            document.addEventListener('pointerdown', this._busyGuard, true);
            document.addEventListener('keydown', this._busyGuard, true);
        } else if (!on && this._busyGuard) {
            document.removeEventListener('click', this._busyGuard, true);
            document.removeEventListener('pointerdown', this._busyGuard, true);
            document.removeEventListener('keydown', this._busyGuard, true);
            this._busyGuard = null;
        }
    }
    isMobile() {
        let agt = navigator.userAgent.toLowerCase();
        return /Android|iPhone|iPad|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|Opera Mini/i.test(navigator.userAgent);
    }
    async backup() {
        let overlay = ui.waitMessage(get('divContainer'));
        return await new Promise((resolve, reject) => {
            let xhr = new XMLHttpRequest();
            xhr.responseType = 'blob';
            xhr.onreadystatechange = (evt) => {
                if (xhr.readyState === 4 && xhr.status === 200) {
                    let obj = window.URL.createObjectURL(xhr.response);
                    var link = document.createElement('a');
                    document.body.appendChild(link);
                    let header = xhr.getResponseHeader('content-disposition');
                    let fname = 'backup';
                    if (typeof header !== 'undefined') {
                        let start = header.indexOf('filename="');
                        if (start >= 0) {
                            let length = header.length;
                            fname = header.substring(start + 10, length - 1);
                        }
                    }
                    console.log(fname);
                    link.setAttribute('download', fname);
                    link.setAttribute('href', obj);
                    link.click();
                    link.remove();
                    setTimeout(() => { window.URL.revokeObjectURL(obj); console.log('Revoked object'); }, 0);
                }
            };
            xhr.onload = (evt) => {
                if (typeof overlay !== 'undefined') overlay.remove();
                let status = xhr.status;
                if (status !== 200) {
                    let err = xhr.response || {};
                    err.htmlError = status;
                    err.service = `GET /backup`;
                    if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
                    console.log('Done');
                    reject(err);
                }
                else {
                    resolve();
                }
            };
            xhr.onerror = (evt) => {
                if (typeof overlay !== 'undefined') overlay.remove();
                let err = {
                    htmlError: xhr.status || 500,
                    service: `GET /backup`
                };
                if (typeof err.desc === 'undefined') err.desc = xhr.statusText || httpStatusText[xhr.status || 500];
                console.log(err);
                reject(err);
            };
            xhr.onabort = (evt) => {
                if (typeof overlay !== 'undefined') overlay.remove();
                console.log('Aborted');
                if (typeof overlay !== 'undefined') overlay.remove();
                reject({ htmlError: status, service: 'GET /backup' });
            };
            xhr.open('GET', baseUrl.length > 0 ? `${baseUrl}/backup` : '/backup', true);
            xhr.send();
        });
    }
    restore() {
        let div = this.createFileUploader('/restore');
        let inst = div.querySelector('#divInstText');
        //[id, bind, texte, checked]
        const opts = [
            ['cbRestoreShades', 'shades', 'RESTORE_SHADES_GROUPS', 1],
            ['cbRestoreFixedCodes', 'fixedCodes', 'RESTORE_RF_SWITCHES', 1],
            ['cbRestoreAutomation', 'automation', 'RESTORE_SCENES_SCHEDULES', 1],
            ['cbRestoreRepeaters', 'repeaters', 'RESTORE_REPEATERS', 0],
            ['cbRestoreSystem', 'settings', 'RESTORE_SYSTEM_SETTINGS', 0],
            ['cbRestoreNetwork', 'network', 'RESTORE_NETWORK_SETTINGS', 0],
            ['cbRestoreMQTT', 'mqtt', 'RESTORE_MQTT_SETTINGS', 0],
            ['cbRestoreTransceiver', 'transceiver', 'RESTORE_RADIO_SETTINGS', 0]
        ];

        let html = opts.map(o => `
        <label class="uniRow" style="padding:8px 0">
        <div class="uniLabel">${tr(o[2])}</div>
        <div class="uniRight">
        <span class="switch">
        <input id="${o[0]}" type="checkbox" data-bind="${o[1]}" ${o[3]?'checked':''}>
        <div></div>
        </span>
        </div>
        </label>`).join('');

        inst.innerHTML = `
        ${overlayHeader('RESTORE_TITLE', 'RESTORE_DESC', 'svg-restore')}
        <div class="uniblocStep"><div>${tr('RESTORE_SELECT_FILE')}</div></div>
        <div id="jsUniRestore" class="unibloc">${html}</div>`;

        shOverlay(div);
    }
    createFileUploader(service) {
        const isRestore = service === '/restore', isPkg = service === '/updatePackage', isMob = this.isMobile(), div = document.createElement('div');
        div.id = 'divUploadFile';
        div.className = 'inst-overlay';

        const step = (n, content, hide = false) => hide ? '' : `
        <div class="v-step-item">
        <div class="v-step-left"><div class="step-counter">${n}</div><div class="v-step-line"></div></div>
        <div class="v-step-right"><div>${content}</div></div>
        </div>`;

        const uploadClick = isPkg
            ? `firmware.uploadUpdatePackage(get('divUploadFile'))`
            : `firmware.uploadFile('${service}',get('divUploadFile'),ui.fromElement(get('divUploadFile')))`;

        const fileOnChange = isPkg
            ? `firmware.onUpdatePackageSelected(this)`
            : `const f=this.files[0];if(f){const s=get('span-selected-file');s.innerText=f.name;s.style.opacity='1';firmware.checkBackupVersion(f)}`;

        const step1Text = isPkg ? tr('FW_UPDATE_PKG_STEP')
            : tr(service === '/updateFirmware' ? 'FIRMWARE_UPDATE_SYSTEM' : 'FIRMWARE_UPDATE_LITTLEFS');

        div.innerHTML = `
        <div class="instructions-content">
        <div class="overlay-scroll-content">
        <form method="POST" action="#" enctype="multipart/form-data" id="frmUploadApp">
        <div id="divInstText"></div>
        <div id="divUpdateTabGithub" class="update-tab-panel" style="display:none;"></div>
        <div id="divUpdateTabLocal" class="update-tab-panel">
        <div class="vertical-steps-container">
        ${step(1, `
        <div style="font-size:14px;">${step1Text}</div>
        <a href="https://github.com/jcvsite/ESPSomfy-RTS/releases" target="_blank" class="link">${tr('FIRMWARE_UPDATE_FROM_GITHUB')}<svg class="svgInTextSmall"><use href="#svg-linkOut"></use></svg></a>
        `, isRestore || isPkg)}
        <div class="v-step-item ${isRestore ? '' : 'has-extra-content'}" style="${isRestore ? 'height:auto;margin:15px 0 0' : ''}">
        <div class="v-step-left" style="${isRestore ? 'display:none' : ''}">
        <div class="step-counter">2</div><div class="v-step-line"></div>
        </div>
        <div class="v-step-right" style="${isRestore ? 'padding-left:0' : ''}">
        <input id="fileName" type="file" name="updateFS" accept="${isPkg ? '.espsomfy,.bin,application/octet-stream' : ''}" style="display:none"
        onchange="${fileOnChange}"/>
        <label for="fileName" class="custom-file-upload">
        <span id="span-selected-file" class="file-name-display">${tr('CHOOSE_FILE')}</span>
        <div class="file-icon-btn"><svg><use href="#svg-upload"></use></svg></div>
        </label>
        </div>
        </div>
        <div id="divPkgParts" class="pkg-parts" style="display:none;">
        <div id="divPkgDeviceInfo" class="pkg-parts-info"></div>
        <div id="divPkgInfo" class="pkg-parts-info"></div>
        <div id="divPkgChipWarn" class="warningText" style="display:none;"></div>
        <label class="pkg-check"><input type="checkbox" id="chkPkgSelectAll" onchange="firmware.onPkgSelectAllChanged(this.checked)"/><span>${tr('FW_UPDATE_PKG_SELECT_ALL')}</span></label>
        <label class="pkg-check"><input type="checkbox" id="chkPkgFw" onchange="firmware.onPkgPartChanged()"/><span id="lblPkgFw">${tr('FW_UPDATE_PKG_PART_FW')}</span></label>
        <label class="pkg-check"><input type="checkbox" id="chkPkgApp" onchange="firmware.onPkgPartChanged()"/><span id="lblPkgApp">${tr('FW_UPDATE_PKG_PART_APP')}</span></label>
        <hr class="pkg-parts-sep"/>
        <label class="pkg-check"><input type="checkbox" id="chkPkgClearCache" checked/><span>${tr('FW_UPDATE_PKG_CLEAR_CACHE')}</span></label>
        </div>
        <div class="v-step-item" style="${isRestore ? 'display:none' : ''}">
        <div class="v-step-left"><div class="step-counter">3</div></div>
        <div class="v-step-right"><div>${tr('FIRMWARE_UPDATE_VERIFY_0')} <svg class="svgInText"><use href="#svg-download"></use></svg> ${tr('FIRMWARE_UPDATE_VERIFY_1')}</div></div>
        </div>
        </div>
        <div class="warning" style="${isRestore ? '' : 'display:none'}">
        <svg><use href=#svg-warning></use></svg>
        <div><b>${tr('MSG_ALERT')}</b><span>${tr('RESTORE_NETWORK_WARNING')}</span></div>
        </div>
        <div class="progress-bar" id="progFileUpload" style="display:none;margin:15px 0"></div>
        </div>
        </div>
        <div class="hrDivFooter"></div>
        <div class="button-container-overlay"><div class="footer-sticky-content">
        <div class="uniRow backup-row" style="${isRestore ? 'display:none' : ''}">
        <div class="uniText">
        <span class="uniLabel">${tr('FIRMWARE_SAVE_BACKUP')}</span>
        <span class="uniStatus">${tr(isMob ? 'FIRMWARE_SAVE_BACKUP_DESC_MOB' : 'FIRMWARE_SAVE_BACKUP_DESC')}</span>
        </div>
        <div id="btnBackupCfg" class="gitBackup" onclick="firmware.backup()"><svg><use href="#svg-download"></use></svg></div>
        </div>
        <label class="pkg-check" id="lblMeshUpdatePeers" style="display:none;">
            <input type="checkbox" id="chkMeshUpdatePeers" checked/>
            <span>${tr('MESH_UPDATE_PEERS') || 'Also update Repeaters'}</span>
        </label>
        <div class="button-container-row">
        <button id="btnClose" line type="button" onclick="closeOverlay(get('divUploadFile'))">${tr('BT_CANCEL_1')}</button>
        <button id="btnGitUpdate" type="button" class="btn-main" style="display:none;" disabled onclick="firmware.installGitRelease(get('divUploadFile'))">${tr('BT_UPDATE')}</button>
        <button id="btnUploadFile" type="button"${isPkg ? ' disabled' : ''} onclick="${uploadClick}">${isPkg ? tr('BT_UPDATE') : tr('BT_UPLOAD_FILE')}</button>
        </div>
        </div></div>
        </form>
        </div>`;

        return div;
    }
    checkBackupVersion(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const lines = e.target.result.split('\n');
            if (lines.length > 0) {
                const ver = parseInt(lines[0].split(',')[0]);
                if (!isNaN(ver) && ver < 25) {
                    let prompt = ui.promptMessage(tr('PROMPT_RESTORE_FILE_TITLE'), () => closeOverlay(prompt));

                    prompt.querySelector('.sub-message').innerHTML = `<p style="color:var(--txt-orange); font-weight:bold;"><p>${tr('PROMPT_RESTORE_FILE_DESC')}</p><p><b>${tr('PROMPT_RESTORE_FILE_DESC_1')}</b></p><p>${tr('PROMPT_RESTORE_FILE_DESC_2')}</p>`;

                    const btnCan = prompt.querySelector('button[line]');
                    if (btnCan) {
                        btnCan.onclick = () => {
                            get('fileName').value = "";
                            get('span-selected-file').innerText = tr('CHOOSE_FILE');
                            closeOverlay(prompt);
                        };
                    }
                }
            }
        };
        reader.readAsText(file.slice(0, 100));
    }
    procMemoryStatus(mem) {
        console.log(mem);
        let sp = get('spanFreeMemory');
        if (sp) sp.innerHTML = mem.free.fmt("#,##0 ");
        sp = get('spanMaxMemory');
        if (sp) sp.innerHTML = mem.max.fmt('#,##0 ');
        sp = get('spanMinMemory');
        if (sp) sp.innerHTML = mem.min.fmt('#,##0 ');
    }
    procFwStatus(rel) {
        const divsGlobal = document.querySelectorAll('.firmware-message');
        const note = get('divOptionsFwNote');
        const ver = rel.latest?.name || '';
        const html = this.fwUpdateNoteHtml(ver);
        const bindChanges = (root) => {
            root.querySelectorAll('.fw-update-changes').forEach(el => {
                el.onclick = (e) => {
                    e.stopPropagation();
                    const u = el.getAttribute('data-url');
                    if (u) window.open(u, '_blank', 'noopener');
                };
            });
        };

        divsGlobal.forEach(div => {
            div.classList.remove('procFwStatusshow');
            div.onclick = null;
            div.innerHTML = '';
        });
        if (note) { note.style.display = 'none'; note.innerHTML = ''; }

        if (rel.available && rel.status === 0 && ver) {
            divsGlobal.forEach(div => {
                div.classList.add('procFwStatusshow');
                div.style.cursor = 'pointer';
                div.onclick = () => { firmware.updateManual(); };
                div.innerHTML = html;
                bindChanges(div);
            });
            if (note) {
                note.style.display = '';
                note.innerHTML = html;
                bindChanges(note);
            }
        }
        else if (rel.status === 4) {
            firmware.setUpdateBusy(false);
            let inst = get('divGitInstall') || get('divUploadFile');
            if (inst) inst.remove();
            if (typeof general !== 'undefined' && general.refreshVersions) general.refreshVersions();
            if (rel.error !== 0) {
                let e = errors.find(x => x.code === rel.error) || { desc: tr('ERR_UNSPECIFIED') };
                ui.errorMessage(e.desc);
            } else {
                let title = `<svg><use xlink:href="#svg-succes"></use></svg>`;
                let infoDiv = ui.errorMessage(title);
                infoDiv.querySelector('.sub-message').innerHTML = `${tr('GIT_RELEASE_SUCCES_1')}<br>${tr('GIT_RELEASE_SUCCES_2')}`;
                let btn = infoDiv.querySelector('button');
                if (btn) {
                    btn.innerText = tr('BT_RELOAD') || 'Reload';
                    btn.onclick = function() { location.reload(); };
                }
            }
        }
    }
    fwUpdateNoteHtml(ver) {
        const url = `https://github.com/jcvsite/ESPSomfy-RTS/releases/tag/${encodeURIComponent(ver)}`;
        return `<span>${tr('FW_UPDATE_AVAILABLE')}: ${ver}</span><span class="fw-update-changes" data-url="${url}">${tr('FW_UPDATE_CHANGES') || 'Changes'}</span>`;
    }
    procUpdateProgress(prog) {
        const pct = Math.round((prog.loaded / prog.total) * 100);
        general.reloadApp = true;
        const git = get('divGitInstall') || get('divUploadFile');

        if (git) {
            // Do not treat FS progress 100% as success — wait for fwStatus COMPLETE + error 0
            // (remount/restore may still fail after the download finishes).
            if (prog.part === 100) {
                const btnCancel = get('btnCancelUpdate');
                if (btnCancel) btnCancel.style.display = 'none';
            }
            const p = (prog.part === 100) ?
            get('progApplicationDownload') :
            get('progFirmwareDownload');

            if (p) {
                p.style.setProperty('--progress', `${pct}%`);
                p.setAttribute('data-progress', `${pct}%`);
            }
        }
    }
    // Extrait juste le premier nombre après le 'v' (ex: "v2.5.2" -> 2, "v3.0.0" -> 3, "3.1.2" -> 3)
    getMainVersion(verStr) {
        if (!verStr) return 0;
        const match = verStr.match(/[vV]?(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    }

    async installGitRelease(div) {
        const btn = this.gitUpdateButton(div);
        if (btn?.disabled) return;
        let obj = ui.fromElement(div);
        if (!obj.version) return;
        const currentMajor = this.getMainVersion(div?.getAttribute('data-currentver'));
        const targetMajor = this.getMainVersion(obj.version);

        // Sécurité absolue contre le contournement HTML
        if ((currentMajor < 3 && targetMajor >= 3) || (currentMajor >= 3 && targetMajor < 3)) {
            ui.errorMessage(tr('MSG_ALERT')).querySelector('.sub-message').innerHTML = tr('ERR_GIT_PARTITION_BLOCKED');
            return;
        }
        try { await firmware.backup(); }
        catch (err) { return ui.serviceError(div, err); }
        const startGit = () => {
        putJSONSync(`/downloadFirmware?ver=${obj.version}`, {}, (err, ver) => {
            if (err) return ui.serviceError(err);
            general.reloadApp = true;
            const desc = tr('GIT_RELEASE_DESC').replace('%1', ver.name);

            div.innerHTML = `
            <div class="instructions-content">

            ${overlayHeader('GIT_RELEASE_TITLE', '', 'svg-github')}
            <div class="warning">
            <svg><use href=#svg-warning></use></svg>
            <div><b>${tr('GIT_RELEASE_WAIT_WARNING')}</b><span>${tr('GIT_RELEASE_WAIT_WARNING_1')}</span></div>
            </div>
            <div class="progress-bar" id="progFirmwareDownload"></div>
            <label for="progFirmwareDownload">${tr('GIT_RELEASE_FIRMWARE_INSTALL_PROGRESS')}</label>
            <div class="progress-bar" id="progApplicationDownload"></div>
            <label for="progApplicationDownload">${tr('GIT_RELEASE_APPLICATION_INSTALL_PROGRESS')}</label>
            <div class="button-container-col">
            <button id="btnCancelUpdate" line type="button">${tr('BT_CANCEL_1')}</button>
            </div>
            </div>`;

            const hP = div.querySelector('.instructions-header p');
            if (hP) hP.innerHTML = desc;

            firmware.setUpdateBusy(true);
            div.querySelector('[close]').onclick = (e) => { e.preventDefault(); e.stopPropagation(); };
            div.querySelector('#btnCancelUpdate').onclick = () => firmware.cancelInstallGit(div);
        });
        };
        if (get('chkMeshUpdatePeers')?.checked) {
            putJSONSync('/mesh/pushUpdate', { peer: 'all', ver: obj.version, follow: true }, () => startGit());
        } else startGit();
    }
    cancelInstallGit(div) {
        putJSONSync(`/cancelFirmware`, {}, (err) => {
            firmware.setUpdateBusy(false);
            if (err) ui.serviceError(err);
            closeOverlay(div);
        });
    }
    updateGithub() {
        this.updateManual();
    }
    gitReleasesUrl() {
        return 'https://github.com/jcvsite/ESPSomfy-RTS/releases';
    }
    gitUpdateButton(div) {
        return div?.querySelector('#btnGitUpdate') || div?.querySelector('#btnUpdate');
    }
    setGitUpdateEnabled(div, on) {
        const btn = this.gitUpdateButton(div);
        if (btn) btn.disabled = !on;
    }
    syncLocalUpdateButton(div) {
        const btn = div?.querySelector('#btnUploadFile');
        if (btn) btn.disabled = !this._pkgParsed;
    }
    fillGithubPanel(div, panel) {
        this.setGitUpdateEnabled(div, false);
        panel.innerHTML = `<div class="wifiConnectScan"><div class="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div></div>`;
        const releasesUrl = this.gitReleasesUrl();
        const linkSvg = '<svg class="svgInTextSmall"><use href="#svg-linkOut"></use></svg>';
        getJSONSync('/getReleases', (err, rel) => {
            if (err) {
                this.setGitUpdateEnabled(div, false);
                panel.innerHTML = `<div class="empty-desc">${tr('ERR_UNSPECIFIED')}</div>`;
                return ui.serviceError(err);
            }
            const chip = (get('divContainer').getAttribute('data-chipmodel') || '').toLowerCase();
            const installed = rel.appVersion?.name || '';
            div.setAttribute('data-currentver', installed);
            if (!Array.isArray(rel.releases)) rel.releases = [];
            rel.releases.sort((a, b) => a.preRelease === b.preRelease && b.draft === a.draft ? 0 : a.preRelease ? 1 : -1);
            const optsHtml = rel.releases.map(r => {
                const name = r.name.toLowerCase();
                if (name === 'main' || name === 'master' || (r.hwVersions.length > 0 && r.hwVersions.indexOf(chip) < 0)) return '';
                return `<option value="${r.version.name}" data-prerelease="${r.preRelease}">${r.name}${r.preRelease ? ' - Pre' : ''}</option>`;
            }).join('');
            if (!optsHtml.trim()) {
                this.setGitUpdateEnabled(div, false);
                panel.innerHTML = `
                <div class="uniRow"><span class="label">${tr('FIRMWARE_INSTALLED')}</span><span class="labelgrey">${installed}</span></div>
                <a href="${releasesUrl}" target="_blank" class="link">${tr('FIRMWARE_NOTE_GITHUB')}${linkSvg}</a>
                <div class="empty-desc">${tr('FW_UPDATE_NO_GITHUB') || 'No GitHub update available.'}</div>`;
                return;
            }
            panel.innerHTML = `
            <div class="uniRow"><span class="label">${tr('FIRMWARE_INSTALLED')}</span><span class="labelgrey">${installed}</span></div>
            <div class="uniRow">
            <span class="label">${tr('FIRMWARE_AVAILABLE')}</span>
            <select id="selVersion" class="selectCompac" data-bind="version">${optsHtml}</select>
            </div>
            <a id="lnkGithubRelease" href="${releasesUrl}" target="_blank" class="link">${tr('FIRMWARE_NOTE_GITHUB')}${linkSvg}</a>
            <div id="divPrereleaseWarning" class="error" style="display:none;"><svg><use href=#svg-error></use></svg><div><span id="spanUpdateWarning"></span></div></div>
            <div id="notesPreview" class="release-notes-preview">
            <div class="wifiConnectScan"><div class="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div></div>
            </div>`;
            const sel = div.querySelector('#selVersion');
            const updateNotes = async () => {
                const nDiv = div.querySelector('#notesPreview'), lnk = div.querySelector('#lnkGithubRelease');
                if (!nDiv || !sel) return;
                const tag = sel.value;
                this.setGitUpdateEnabled(div, false);
                if (!tag) {
                    if (lnk) lnk.href = releasesUrl;
                    nDiv.innerHTML = `<div class="empty-desc">${tr('FW_UPDATE_NO_GITHUB') || 'No GitHub update available.'}</div>`;
                    return;
                }
                if (lnk) lnk.href = `${releasesUrl}/tag/${encodeURIComponent(tag)}`;
                nDiv.innerHTML = '<div class="wifiConnectScan"><div class="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div></div>';
                try {
                    const r = await firmware.getReleaseInfo(tag, true);
                    if (r?.info?.body) {
                        nDiv.innerHTML = firmware.parseMarkdown(r.info.body);
                        if (lnk && r.info.html_url) lnk.href = r.info.html_url;
                        if (this.gitReleaseSelected(div)) this.setGitUpdateEnabled(div, true);
                    } else throw new Error('No body');
                } catch (e) {
                    this.setGitUpdateEnabled(div, false);
                    nDiv.innerHTML = `<div class="divGitNoteError"><div class="gitNoteError">${tr('ERR_GIT_NOTE')}</div><div class="gitNoteErrorSub">${tr('UPDATE_GIT_NOTE')}</div></div>`;
                }
            };
            if (sel) {
                sel.addEventListener('change', () => { this.gitReleaseSelected(div); updateNotes(); });
                this.gitReleaseSelected(div);
                updateNotes();
            }
        });
    }
    gitReleaseSelected(div) {
        const sel = div.querySelector('#selVersion');
        const btnUpdate = this.gitUpdateButton(div);
        if (!sel || sel.selectedIndex === -1 || !sel.value) {
            if (btnUpdate) btnUpdate.disabled = true;
            return false;
        }

        const opt = sel.options[sel.selectedIndex];
        const isPre = opt.getAttribute('data-prerelease') === "true";
        const divPre = div.querySelector('#divPrereleaseWarning');
        const spanWarning = div.querySelector('#spanUpdateWarning');
        const currentMajor = this.getMainVersion(div.getAttribute('data-currentver'));
        const targetMajor = this.getMainVersion(sel.value);

        let isBlocked = false;
        let blockMessage = '';

        if (currentMajor < 3 && targetMajor >= 3) {
            isBlocked = true;
            blockMessage = tr('UPDATE_GIT_UPDATE_V3_BLOCKED');
        }
        else if (currentMajor >= 3 && targetMajor < 3) {
            isBlocked = true;
            blockMessage = tr('UPDATE_GIT_DOWNGRADE_V3_BLOCKED');
        }

        if (isBlocked) {
            if (spanWarning) spanWarning.innerHTML = blockMessage;
            if (divPre) divPre.style.display = 'flex';
            if (btnUpdate) btnUpdate.disabled = true;
            return false;
        }
        if (divPre) {
            if (isPre) {
                if (spanWarning) spanWarning.innerHTML = tr('UPDATE_GIT_RELEASE_BETA');
                divPre.style.display = 'flex';
            } else {
                divPre.style.display = 'none';
            }
        }
        const divNotes = div.querySelector('#divReleaseNotes');
        if (divNotes) {
            const val = sel.value;
            divNotes.style.display = (!val || val === 'main') ? 'none' : '';
        }
        return true;
    }
    async getReleaseInfo(tag, silent = false) {
        let overlay = null;
        if (!silent) overlay = ui.waitMessage(document.getElementById('divContainer'));
        try {
            let ret = { resp: { ok: false }, info: null };
            ret.resp = await fetch(`https://api.github.com/repos/jcvsite/ESPSomfy-RTS/releases/tags/${tag}`);
            if (ret.resp.ok) {
                ret.info = await ret.resp.json();
            }
            return ret;
        }
        catch (err) {
            return { resp: { ok: false }, err: err };
        }
        finally {
            if (overlay) overlay.remove();
        }
    }
    formatInlineMarkdown(txt) {
        if (!txt) return '';
        return txt
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/`([^`]+)`/g, '<code class="md-code-inline">$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="md-link">$1</a>')
        .replace(/(?<!["=>])(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" class="md-link-auto">$1</a>');
    }
    parseMarkdown(bodyText) {
        const self = this;
        const ctx = {
            lines: (bodyText || "").split(/\r?\n/),
            ndx: 0,
            html: '',
            token(txt) {
                const trimmed = txt.trim();
                if (!trimmed) return { type: 'empty' };
                const firstChar = txt.match(/\S/);
                const indent = firstChar ? txt.indexOf(firstChar[0]) : 0;
                if (trimmed.startsWith('#')) return { type: 'head', txt: trimmed, indent };
                if (trimmed.startsWith('* ')) return { type: 'list', txt: trimmed.substring(2), indent };
                return { type: 'text', txt: trimmed, indent };
            },
            renderHead(token) {
                const level = (token.txt.match(/^#+/) || ["#"])[0].length;
                const content = token.txt.replace(/^#+\s*/, '');
                return `<h${level} style="margin: 10px 0 5px 0;">${self.formatInlineMarkdown(content)}</h${level}>`;
            },
            renderList() {
                let listHtml = '<ul class="md-list" style="padding:0; margin:5px 0;">';
                while (this.ndx < this.lines.length) {
                    const t = this.token(this.lines[this.ndx]);
                    if (t.type !== 'list') break;
                    const margin = (t.indent * 8) + 20;
                    listHtml += `<li style="margin-left:${margin}px; text-align:left; list-style-type:disc;">${self.formatInlineMarkdown(t.txt)}</li>`;
                    this.ndx++;
                }
                listHtml += '</ul>';
                return listHtml;
            },
            parse() {
                while (this.ndx < this.lines.length) {
                    const t = this.token(this.lines[this.ndx]);
                    switch (t.type) {
                        case 'head': this.html += this.renderHead(t); this.ndx++; break;
                        case 'list': this.html += this.renderList(); break;
                        case 'empty': this.html += '<div style="height:8px"></div>'; this.ndx++; break;
                        default:
                            const margin = (t.indent * 8) + (t.indent > 0 ? 20 : 0);
                            this.html += `<p style="margin: 2px 0; margin-left:${margin}px; text-align:left; line-height:1.4;">${self.formatInlineMarkdown(t.txt)}</p>`;
                            this.ndx++;
                            break;
                    }
                }
            }
        };
        ctx.parse();
        return ctx.html;
    }
    async updateManual(isApp = false) {
        void isApp;
        if (typeof general !== 'undefined' && general.refreshVersions)
            await general.refreshVersions();
        const div = this.createFileUploader('/updatePackage');
        this._pkgParsed = null;

        div.querySelector('#divInstText').innerHTML = `
        ${overlayHeader('MANUAL_UPDATE_TITLE', 'FW_UPDATE_PKG_DESC', 'svg-update')}
        <div class="subtab-container overlay-subtabs">
            <span class="selected" data-updatetab="local">${tr('FW_UPDATE_TAB_LOCAL') || 'Local file'}</span>
            <span data-updatetab="github">${tr('FW_UPDATE_TAB_GITHUB') || 'GitHub'}</span>
        </div>`;

        div.className += ' mode-pkg-update';
        shOverlay(div);

        const btnB = div.querySelector('#btnBackupCfg');
        if (btnB) {
            btnB.style.display = 'flex';
            btnB.onclick = () => firmware.backup();
        }
        div._githubLoaded = false;
        div.querySelectorAll('[data-updatetab]').forEach(tab => {
            tab.addEventListener('click', () => this.setUpdateTab(div, tab.getAttribute('data-updatetab')));
        });
        this.setUpdateTab(div, 'local');
        this.syncMeshPeerOption();
    }
    syncMeshPeerOption() {
        const lbl = get('lblMeshUpdatePeers');
        const chk = get('chkMeshUpdatePeers');
        if (!lbl || !chk) return;
        const apply = (peers) => {
            const role = document.documentElement.getAttribute('data-mesh-role');
            const online = (peers || []).filter(p => p.online).length;
            const show = role === 'router' && online > 0;
            lbl.style.display = show ? '' : 'none';
            if (show && !lbl.dataset.userSet) chk.checked = true;
            chk.onchange = () => { lbl.dataset.userSet = '1'; };
        };
        const cached = (typeof mesh !== 'undefined' && mesh.state && mesh.state.peers) || [];
        apply(cached);
        getJSON('/mesh/state', (err, st) => {
            if (err || !st) return;
            if (typeof mesh !== 'undefined') mesh.state = st;
            apply(st.peers || []);
        });
    }
    setUpdateTab(div, tab) {
        const github = tab === 'github';
        div.querySelectorAll('[data-updatetab]').forEach(t => t.classList.toggle('selected', t.getAttribute('data-updatetab') === tab));
        const g = div.querySelector('#divUpdateTabGithub');
        const l = div.querySelector('#divUpdateTabLocal');
        if (g) g.style.display = github ? '' : 'none';
        if (l) l.style.display = github ? 'none' : '';
        const btnGit = div.querySelector('#btnGitUpdate');
        const btnUp = div.querySelector('#btnUploadFile');
        if (btnGit) btnGit.style.display = github ? '' : 'none';
        if (btnUp) {
            btnUp.style.display = github ? 'none' : '';
            if (!github) this.syncLocalUpdateButton(div);
        }
        if (github && g && !div._githubLoaded) {
            div._githubLoaded = true;
            this.fillGithubPanel(div, g);
        }
    }
    fmtBytes(n) {
        if (!n && n !== 0) return '—';
        if (n < 1024) return `${n} B`;
        if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / 1048576).toFixed(2)} MB`;
    }
    deviceFwVersion() {
        return (get('spanFwVersion')?.innerText || '').trim() || '—';
    }
    deviceAppVersion() {
        return (get('spanAppVersion')?.innerText || general?.appVersion || '').trim() || '—';
    }
    normalizeVersion(ver) {
        if (!ver) return '';
        const m = String(ver).trim().match(/v?(\d+(?:\.\d+){0,3})/i);
        return m ? m[1] : '';
    }
    compareVersions(a, b) {
        const pa = this.normalizeVersion(a).split('.').map(n => parseInt(n, 10) || 0);
        const pb = this.normalizeVersion(b).split('.').map(n => parseInt(n, 10) || 0);
        const len = Math.max(pa.length, pb.length, 3);
        for (let i = 0; i < len; i++) {
            const x = pa[i] || 0, y = pb[i] || 0;
            if (x < y) return -1;
            if (x > y) return 1;
        }
        return 0;
    }
    isOlderVersion(pkg, device) {
        if (!this.normalizeVersion(pkg) || !this.normalizeVersion(device)) return false;
        return this.compareVersions(pkg, device) < 0;
    }
    versionFromFilename(name) {
        if (!name) return '';
        const m = String(name).match(/(?:^|[^\d])v?(\d+\.\d+\.\d+)(?:[^0-9]|$)/i);
        return m ? `v${m[1]}` : '';
    }
    versionFromHeader(buf) {
        if (!buf || buf.byteLength < 32) return '';
        const bytes = new Uint8Array(buf, 20, 12);
        let s = '';
        for (let i = 0; i < bytes.length && bytes[i]; i++) s += String.fromCharCode(bytes[i]);
        s = s.trim();
        return this.normalizeVersion(s) ? (s.toLowerCase().startsWith('v') ? s : `v${this.normalizeVersion(s)}`) : '';
    }
    displayVersion(ver) {
        return ver || (tr('FW_UPDATE_PKG_VER_UNKNOWN') || 'unknown');
    }
    parseEspsomfy(buf) {
        if (!buf || buf.byteLength < 32) throw new Error('ERR_INVALID_FILE_PACKAGE');
        const u8 = new Uint8Array(buf, 0, 8);
        const magic = String.fromCharCode(...u8);
        if (magic !== 'ESPSOMFY') throw new Error('ERR_INVALID_FILE_PACKAGE');
        const view = new DataView(buf);
        const hdrVer = view.getUint16(8, true);
        if (hdrVer !== 1) throw new Error('ERR_INVALID_FILE_PACKAGE');
        const chipId = view.getUint8(10);
        const flags = view.getUint8(11);
        const fwSize = view.getUint32(12, true);
        const fsSize = view.getUint32(16, true);
        const chipNames = {
            0: 'esp32', 1: 'esp32wrover', 2: 'esp32c3', 3: 'esp32s2',
            4: 'esp32s3_4mb', 5: 'esp32s3_8mb'
        };
        let offset = 32;
        let fw = null, fs = null;
        if (flags & 1) {
            if (offset + fwSize > buf.byteLength) throw new Error('ERR_INVALID_FILE_PACKAGE');
            fw = buf.slice(offset, offset + fwSize);
            offset += fwSize;
        }
        if (flags & 2) {
            if (offset + fsSize > buf.byteLength) throw new Error('ERR_INVALID_FILE_PACKAGE');
            fs = buf.slice(offset, offset + fsSize);
        }
        return {
            chipId,
            chipName: chipNames[chipId] || `chip${chipId}`,
            hasFw: !!(flags & 1 && fw && fw.byteLength),
            hasFs: !!(flags & 2 && fs && fs.byteLength),
            fwSize: fw ? fw.byteLength : 0,
            fsSize: fs ? fs.byteLength : 0,
            version: this.versionFromHeader(buf),
            fw, fs
        };
    }
    async onUpdatePackageSelected(input) {
        const file = input.files && input.files[0];
        const span = get('span-selected-file');
        const parts = get('divPkgParts');
        this._pkgParsed = null;
        if (!file) {
            if (span) { span.innerText = tr('CHOOSE_FILE'); span.style.opacity = ''; }
            if (parts) parts.style.display = 'none';
            this.syncLocalUpdateButton(get('divUploadFile'));
            return;
        }
        if (span) { span.innerText = file.name; span.style.opacity = '1'; }
        const name = file.name.toLowerCase();
        try {
            const buf = await file.arrayBuffer();
            let parsed;
            const fileVer = this.versionFromFilename(file.name);
            if (name.endsWith('.espsomfy') || (buf.byteLength >= 8 && String.fromCharCode(...new Uint8Array(buf, 0, 8)) === 'ESPSOMFY')) {
                parsed = this.parseEspsomfy(buf);
                if (!parsed.version) parsed.version = fileVer;
            } else if (name.includes('.littlefs') && name.endsWith('.bin')) {
                parsed = {
                    chipId: -1, chipName: '', hasFw: false, hasFs: true,
                    fwSize: 0, fsSize: buf.byteLength, fw: null, fs: buf,
                    version: fileVer
                };
            } else if (name.includes('.ino.') && name.endsWith('.bin')) {
                parsed = {
                    chipId: -1, chipName: '', hasFw: true, hasFs: false,
                    fwSize: buf.byteLength, fsSize: 0, fw: buf, fs: null,
                    version: fileVer
                };
            } else {
                throw new Error('ERR_INVALID_FILE_PACKAGE');
            }
            this._pkgParsed = parsed;
            if (typeof general !== 'undefined' && general.refreshVersions)
                await general.refreshVersions();
            this.applyPkgPartUi(parsed);
            this.syncLocalUpdateButton(get('divUploadFile'));
        } catch (e) {
            this._pkgParsed = null;
            if (parts) parts.style.display = 'none';
            this.syncLocalUpdateButton(get('divUploadFile'));
            ui.errorMessage(tr('MSG_ALERT')).querySelector('.sub-message').innerHTML = tr(e.message || 'ERR_INVALID_FILE_PACKAGE');
            input.value = '';
            if (span) { span.innerText = tr('CHOOSE_FILE'); span.style.opacity = ''; }
        }
    }
    applyPkgPartUi(parsed) {
        const parts = get('divPkgParts');
        if (!parts || !parsed) return;
        parts.style.display = '';
        const fwVer = this.deviceFwVersion();
        const appVer = this.deviceAppVersion();
        const pkgVer = this.displayVersion(parsed.version);
        const deviceInfo = get('divPkgDeviceInfo');
        if (deviceInfo) {
            deviceInfo.innerHTML = (tr('FW_UPDATE_PKG_DEVICE') || 'Device: firmware %1 · UI %2')
                .replace('%1', fwVer)
                .replace('%2', appVer);
        }
        const info = get('divPkgInfo');
        if (info) {
            info.innerHTML = (tr('FW_UPDATE_PKG_INFO') || 'Package %3 — firmware %1 · application %2')
                .replace('%1', parsed.hasFw ? this.fmtBytes(parsed.fwSize) : '—')
                .replace('%2', parsed.hasFs ? this.fmtBytes(parsed.fsSize) : '—')
                .replace('%3', pkgVer);
        }
        const lblFw = get('lblPkgFw');
        if (lblFw) {
            lblFw.innerHTML = parsed.hasFw
                ? (tr('FW_UPDATE_PKG_PART_FW_VER') || 'Firmware — package %1 (device %2)')
                    .replace('%1', pkgVer)
                    .replace('%2', fwVer)
                : (tr('FW_UPDATE_PKG_PART_FW') || 'Firmware');
        }
        const lblApp = get('lblPkgApp');
        if (lblApp) {
            lblApp.innerHTML = parsed.hasFs
                ? (tr('FW_UPDATE_PKG_PART_APP_VER') || 'Application — package %1 (device %2)')
                    .replace('%1', pkgVer)
                    .replace('%2', appVer)
                : (tr('FW_UPDATE_PKG_PART_APP') || 'Application (web UI)');
        }
        const warn = get('divPkgChipWarn');
        if (warn) {
            const deviceChip = (get('divContainer')?.getAttribute('data-chipmodel') || '').toLowerCase();
            const pkgChip = (parsed.chipName || '').toLowerCase();
            let soft = false;
            if (pkgChip && deviceChip) {
                const simple = (s) => s.replace(/[^a-z0-9]/g, '');
                const d = simple(deviceChip);
                const p = simple(pkgChip).replace(/4mb|8mb/g, '');
                soft = !d.includes(p) && !p.includes(d);
            }
            if (soft) {
                warn.style.display = '';
                warn.innerHTML = `<span>${tr('FW_UPDATE_PKG_CHIP_WARN').replace('%1', parsed.chipName).replace('%2', deviceChip)}</span>`;
            } else {
                warn.style.display = 'none';
                warn.innerHTML = '';
            }
        }
        const chkFw = get('chkPkgFw');
        const chkApp = get('chkPkgApp');
        const chkAll = get('chkPkgSelectAll');
        const chkCache = get('chkPkgClearCache');
        if (chkFw) {
            chkFw.disabled = !parsed.hasFw;
            chkFw.checked = !!parsed.hasFw;
        }
        if (chkApp) {
            chkApp.disabled = !parsed.hasFs;
            chkApp.checked = !!parsed.hasFs;
        }
        if (chkAll) {
            chkAll.checked = !!(parsed.hasFw && parsed.hasFs);
            chkAll.disabled = !(parsed.hasFw || parsed.hasFs);
        }
        if (chkCache) chkCache.checked = !!parsed.hasFs;
        this.onPkgPartChanged();
    }
    confirmDowngradeIfNeeded(parsed, wantFw, wantApp) {
        return new Promise((resolve) => {
            const pkg = parsed?.version || '';
            if (!this.normalizeVersion(pkg)) {
                resolve(true);
                return;
            }
            const curFw = this.deviceFwVersion();
            const curApp = this.deviceAppVersion();
            const olderFw = wantFw && this.isOlderVersion(pkg, curFw);
            const olderApp = wantApp && this.isOlderVersion(pkg, curApp);
            if (!olderFw && !olderApp) {
                resolve(true);
                return;
            }
            const deviceShown = olderFw ? curFw : curApp;
            const prompt = ui.promptMessage(tr('PROMPT_DOWNGRADE_TITLE') || 'Install older version?', () => resolve(true));
            prompt.querySelector('.sub-message').innerHTML =
                `<p>${(tr('PROMPT_DOWNGRADE_DESC') || 'The selected package (%1) is older than this device (%2). Continue anyway?')
                    .replace('%1', this.displayVersion(pkg))
                    .replace('%2', deviceShown)}</p>`;
            const btnNo = prompt.querySelector('button[line]');
            if (btnNo) {
                btnNo.onclick = () => {
                    ui.clearErrors();
                    resolve(false);
                };
            }
        });
    }
    onPkgSelectAllChanged(checked) {
        const chkFw = get('chkPkgFw');
        const chkApp = get('chkPkgApp');
        if (chkFw && !chkFw.disabled) chkFw.checked = checked;
        if (chkApp && !chkApp.disabled) chkApp.checked = checked;
        this.onPkgPartChanged();
    }
    onPkgPartChanged() {
        const chkFw = get('chkPkgFw');
        const chkApp = get('chkPkgApp');
        const chkAll = get('chkPkgSelectAll');
        const chkCache = get('chkPkgClearCache');
        if (chkAll && chkFw && chkApp) {
            const available = [];
            if (!chkFw.disabled) available.push(chkFw.checked);
            if (!chkApp.disabled) available.push(chkApp.checked);
            chkAll.checked = available.length > 0 && available.every(Boolean);
        }
        if (chkCache && chkApp && chkApp.checked) chkCache.checked = true;
    }
    postUpdateBlob(service, blob, filename, { reboot = true, onProgress = null } = {}) {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('file', blob, filename);
            let url = baseUrl ? `${baseUrl}${service}` : service;
            if (!reboot) url += (url.includes('?') ? '&' : '?') + 'reboot=0';
            if (blob && blob.size && service.indexOf('/mesh/pushUpdate') === 0)
                url += (url.includes('?') ? '&' : '?') + 'size=' + blob.size;
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.timeout = 10 * 60 * 1000; // large FS/FW on slow Wi‑Fi
            xhr.upload.onprogress = (evt) => {
                if (onProgress && evt.total) onProgress(Math.min(0.97, evt.loaded / evt.total));
            };
            xhr.upload.onload = () => {
                // Bytes sent; device remounts FS then replies (shade restore runs after the reply).
                if (onProgress) onProgress(0.99);
                const prog = get('progFileUpload') || get('progApplicationDownload');
                if (prog) prog.setAttribute('data-progress', tr('FW_UPDATE_FINALIZING') || 'Finalizing…');
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const j = JSON.parse(xhr.responseText || '{}');
                        if (j.status && j.status !== 'SUCCESS') {
                            reject(new Error(j.desc || 'ERR_UPDATE_UPLOAD_FAILED'));
                            return;
                        }
                    } catch (_) { /* non-JSON success still ok */ }
                    if (onProgress) onProgress(1);
                    resolve();
                } else {
                    reject(new Error(tr('ERR_UPDATE_UPLOAD_FAILED').replace('%1', String(xhr.status))));
                }
            };
            xhr.onerror = () => reject(new Error('Upload Failed'));
            xhr.ontimeout = () => reject(new Error('Upload timed out'));
            xhr.onabort = () => reject(new Error('Upload cancelled'));
            xhr.send(formData);
            this._pkgXhr = xhr;
        });
    }
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async waitDeviceReady(timeoutMs = 30000) {
        const origin = baseUrl || '';
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const res = await fetch(`${origin}/controller?_=${Date.now()}`, {
                    method: 'GET',
                    cache: 'no-store',
                    credentials: 'same-origin'
                });
                if (res.ok) return true;
            } catch (_) { /* device settling */ }
            await this._sleep(750);
        }
        return false;
    }
    meshPeerUpdateJobs(parsed, wantFw, wantApp) {
        return new Promise((resolve) => {
            getJSON('/mesh/state', (err, st) => {
                const peers = (!err && st && st.peers) ? st.peers.filter(p => p.online && p.id) : [];
                const jobs = [];
                peers.forEach(p => {
                    if (wantFw && parsed.fw) {
                        jobs.push({
                            service: `/mesh/pushUpdate?peer=${encodeURIComponent(p.id)}&part=fw`,
                            blob: new Blob([parsed.fw], { type: 'application/octet-stream' }),
                            filename: 'SomfyController.ino.esp32.bin',
                            reboot: false,
                            peerId: p.id
                        });
                    }
                    if (wantApp && parsed.fs) {
                        jobs.push({
                            service: `/mesh/pushUpdate?peer=${encodeURIComponent(p.id)}&part=fs`,
                            blob: new Blob([parsed.fs], { type: 'application/octet-stream' }),
                            filename: 'SomfyController.littlefs.bin',
                            reboot: false,
                            peerId: p.id,
                            waitReboot: true
                        });
                    }
                });
                resolve(jobs);
            });
        });
    }
    waitMeshPeer(peerId, timeoutMs = 60000) {
        return new Promise(async (resolve) => {
            const deadline = Date.now() + timeoutMs;
            let sawDown = false;
            while (Date.now() < deadline) {
                const st = await new Promise(res => getJSON('/mesh/state', (e, s) => res(!e && s ? s : null)));
                const p = st && (st.peers || []).find(x => x.id === peerId);
                const on = !!(p && p.online);
                if (!on) sawDown = true;
                else if (sawDown) { resolve(true); return; }
                await this._sleep(1500);
            }
            resolve(false);
        });
    }
    async uploadUpdatePackage(el) {
        const title = tr('MSG_ALERT');
        const parsed = this._pkgParsed;
        const field = el.querySelector('input[type="file"]');
        if (!field?.files?.[0] || !parsed) {
            ui.errorMessage(title).querySelector('.sub-message').innerHTML = tr('ERR_NO_FILE_FIRMWARE_SELECTED');
            return;
        }
        const wantFw = !!(get('chkPkgFw')?.checked && parsed.hasFw);
        const wantApp = !!(get('chkPkgApp')?.checked && parsed.hasFs);
        const clearCache = !!get('chkPkgClearCache')?.checked;
        if (!wantFw && !wantApp) {
            ui.errorMessage(title).querySelector('.sub-message').innerHTML = tr('ERR_NO_UPDATE_PART_SELECTED');
            return;
        }
        if ((wantFw && !parsed.fw) || (wantApp && !parsed.fs)) {
            ui.errorMessage(title).querySelector('.sub-message').innerHTML = tr('ERR_UPDATE_PART_MISSING');
            return;
        }

        if (!(await this.confirmDowngradeIfNeeded(parsed, wantFw, wantApp))) return;

        try { await firmware.backup(); }
        catch (e) { return ui.serviceError(el, e); }

        ['btnBackupCfg', 'btnUploadFile'].forEach(id => {
            const b = el.querySelector('#' + id);
            if (b) b.style.display = 'none';
        });
        field.disabled = true;
        const steps = el.querySelector('.vertical-steps-container');
        if (steps) steps.style.display = 'none';
        const partsUi = get('divPkgParts');
        if (partsUi) partsUi.style.display = 'none';
        const prog = el.querySelector('#progFileUpload');
        const btnCancel = el.querySelector('#btnClose');
        prog.style.display = '';

        const jobs = [];
        if (wantFw) {
            jobs.push({
                service: '/updateFirmware',
                blob: new Blob([parsed.fw], { type: 'application/octet-stream' }),
                filename: 'SomfyController.ino.esp32.bin'
            });
        }
        if (wantApp) {
            jobs.push({
                service: '/updateApplication',
                blob: new Blob([parsed.fs], { type: 'application/octet-stream' }),
                filename: 'SomfyController.littlefs.bin'
            });
        }

        if (clearCache || wantApp) general.reloadApp = true;

        this.setUpdateBusy(true);
        btnCancel.onclick = () => {
            if (this._pkgXhr) try { this._pkgXhr.abort(); } catch (_) {}
            this.setUpdateBusy(false);
            closeOverlay(el);
        };

        const setPct = (pct) => {
            const n = Math.max(0, Math.min(100, Math.round(pct)));
            prog.style.setProperty('--progress', `${n}%`);
            prog.setAttribute('data-progress', `${n}%`);
        };

        try {
            let peerJobs = [];
            if (get('chkMeshUpdatePeers')?.checked) {
                peerJobs = await this.meshPeerUpdateJobs(parsed, wantFw, wantApp);
            }
            const allJobs = peerJobs.concat(jobs);
            for (let i = 0; i < allJobs.length; i++) {
                const job = allJobs[i];
                const isLast = i === allJobs.length - 1;
                const base = i / allJobs.length;
                const span = 1 / allJobs.length;
                let lastErr = null;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        if (i > 0 || attempt > 1) {
                            setPct((base) * 100);
                            await this._sleep(attempt === 1 ? 2000 : 3000 * attempt);
                            if (!job.peerId) await this.waitDeviceReady(25000);
                        }
                        await this.postUpdateBlob(job.service, job.blob, job.filename, {
                            reboot: job.reboot != null ? job.reboot : isLast,
                            onProgress: (p) => setPct((base + span * p) * 100)
                        });
                        lastErr = null;
                        break;
                    } catch (e) {
                        lastErr = e;
                        if (attempt >= 3) throw e;
                    }
                }
                if (lastErr) throw lastErr;
                if (job.peerId && job.waitReboot) await this.waitMeshPeer(job.peerId, 90000);
            }
            setPct(100);
            btnCancel.innerText = tr('BT_CLOSE');
            if (clearCache) general.reloadApp = true;
            this.setUpdateBusy(false);
            general.showRebootWait();
            closeOverlay(el);
        } catch (e) {
            this.setUpdateBusy(false);
            ui.errorMessage(title).querySelector('.sub-message').innerHTML =
                tr('ERR_UPDATE_UPLOAD_FAILED').replace('%1', e.message || e);
            btnCancel.innerText = tr('BT_CLOSE');
        }
    }
    async uploadFile(service, el, data) {
        let field = el.querySelector('input[type="file"]'),
        filename = field.value,
        file = field.files[0],
        title = tr('MSG_ALERT'),
        err = null;

        if (!filename) err = (service === '/restore') ? 'ERR_NO_FILE_BACKUP_SELECTED' : (service === '/updateApplication' ? 'ERR_NO_FILE_LITTLEFS_SELECTED' : 'ERR_NO_FILE_FIRMWARE_SELECTED');
        else if (service === '/updateApplication' && (!filename.includes('.littlefs') || !filename.endsWith('.bin'))) err = 'ERR_INVALID_FILE_LITTLEFS';
        else if (service === '/updateFirmware' && (!filename.includes('.ino.') || !filename.endsWith('.bin'))) err = 'ERR_INVALID_FILE_FIRMWARE';
        else if (service === '/restore') {
            if (file.size > 65536) {
                ui.errorMessage(title).querySelector('.sub-message').innerHTML = tr('ERR_BACKUP_TOO_LARGE').replace('%s', file.size.fmt("#,##0"));
                return;
            }
            if (!filename.endsWith('.backup')) err = 'ERR_INVALID_FILE_BACKUP';
            else if (!['shades', 'fixedCodes', 'automation', 'settings', 'network', 'transceiver', 'repeaters', 'mqtt'].some(k => data[k])) err = 'ERR_NO_RESTORE_OPTION';
        }
        if (err) {
            ui.errorMessage(title).querySelector('.sub-message').innerHTML = tr(err);
            return;
        }
        if (service !== '/restore') {
            try { await firmware.backup(); }
            catch (e) { return ui.serviceError(el, e); }
        }
        let formData = new FormData();
        formData.append('file', file);
        if (service === '/restore') formData.append('data', JSON.stringify(data));

        ['btnBackupCfg', 'btnUploadFile'].forEach(id => { let b = el.querySelector('#' + id); if (b) b.style.display = 'none'; });
        field.disabled = true;
        let steps = el.querySelector('.vertical-steps-container');
        if (steps) steps.style.display = 'none';
        let prog = el.querySelector('#progFileUpload'),
        btnCancel = el.querySelector('#btnClose');
        prog.style.display = '';

        const isFwUpdate = service === '/updateFirmware' || service === '/updateApplication';
        if (isFwUpdate) this.setUpdateBusy(true);

        let xhr = new XMLHttpRequest();
        xhr.open('POST', baseUrl ? `${baseUrl}${service}` : service, true);

        xhr.upload.onprogress = (evt) => {
            let pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0;
            prog.style.setProperty('--progress', `${pct}%`);
            prog.setAttribute('data-progress', `${pct}%`);
        };

        xhr.onload = async () => {
            btnCancel.innerText = tr('BT_CLOSE');
            if (service === '/restore') {
                await somfy.init();
                closeOverlay(get('divUploadFile'));
            } else if (isFwUpdate) {
                general.reloadApp = true;
                this.setUpdateBusy(false);
                general.showRebootWait();
                closeOverlay(el);
            }
        };
        xhr.onerror = () => {
            if (isFwUpdate) this.setUpdateBusy(false);
            ui.serviceError(el, 'Upload Failed');
        };
        xhr.onabort = () => {
            if (isFwUpdate) this.setUpdateBusy(false);
        };
        btnCancel.onclick = () => {
            xhr.abort();
            if (isFwUpdate) this.setUpdateBusy(false);
            closeOverlay(el);
        };
        xhr.send(formData);
    }
}
var firmware = new Firmware();

function meshIp(n) {
    if (n == null) return '--';
    if (typeof n === 'string' && n.indexOf('.') >= 0) return n;
    n = n >>> 0;
    return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255].join('.');
}
class MeshUi {
    state = { role: 0, txMode: 0, peers: [], heard: [], ranks: [], assigned: '', routerIp: 0, routerId: '', routerOnline: false };
    timer = null;
    _slaveHb = {};
    init() {
        const role = document.documentElement.getAttribute('data-mesh-role');
        const connected = document.documentElement.getAttribute('data-mesh-connected') === '1';
        if (role === 'unset' && connected) this.showWizard();
        else this.loadState();
        if (role === 'repeater') {
            const p = document.querySelector('.tab-container > span[data-grpid="divMeshSettings"]');
            if (p && typeof ui !== 'undefined') {
                ui.setConfigPanel();
                p.click();
                const t = document.querySelector('.subtab-container > span[data-grpid="divMeshActivity"]');
                if (t) t.click();
            }
        }
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => this.loadState(), 3000);
        this.refreshActivityChrome();
    }
    onLoggedIn() {
        const role = document.documentElement.getAttribute('data-mesh-role');
        const connected = document.documentElement.getAttribute('data-mesh-connected') === '1';
        if (role === 'unset' && connected) this.showWizard();
    }
    showWizard() {
        const el = get('divMeshWizard');
        if (el) el.style.display = 'flex';
        get('divMeshWizRole').style.display = '';
        get('divMeshWizPair').style.display = 'none';
    }
    wizardBack() {
        get('divMeshWizRole').style.display = '';
        get('divMeshWizPair').style.display = 'none';
    }
    chooseRole(role) {
        if (role === 1) {
            putJSONSync('/mesh/role', { role: 1 }, (err, st) => {
                if (err) return ui.serviceError(err);
                if (!st || Number(st.role) !== 1) {
                    return ui.serviceError({ desc: 'Router role did not save. Try again.' });
                }
                document.documentElement.setAttribute('data-mesh-role', 'router');
                get('divMeshWizard').style.display = 'none';
                general.showRebootWait();
                putJSONSync('/reboot', {}, () => {});
            });
            return;
        }
        get('divMeshWizRole').style.display = 'none';
        get('divMeshWizPair').style.display = '';
        this.refreshHeard();
        if (this._heardTimer) clearInterval(this._heardTimer);
        this._heardTimer = setInterval(() => this.refreshHeard(), 2000);
    }
    refreshHeard() {
        getJSON('/mesh/state', (err, st) => {
            if (err || !st) return;
            const box = get('divMeshHeardList');
            const routers = (st.heard || []).filter(h => h.role === 1);
            if (!routers.length) {
                box.innerHTML = `<div class="empty-desc">${tr('MESH_NO_ROUTERS') || 'No Routers heard yet. Wait a few seconds, or type the IP.'}</div>`;
                return;
            }
            box.innerHTML = routers.map(h => `<div class="mesh-heard-item" data-ip="${meshIp(h.ip)}" data-id="${h.id}" onclick="mesh.pickHeard(this)"><b>${h.hostname || h.id}</b> · ${meshIp(h.ip)} · ${h.fw || ''}${h.auth ? ' · login' : ''}</div>`).join('');
        });
    }
    pickHeard(el) {
        get('fldMeshWizIp').value = el.getAttribute('data-ip') || '';
        this._routerId = el.getAttribute('data-id') || '';
    }
    pairFromWizard() {
        const ip = (get('fldMeshWizIp').value || '').trim();
        const user = (get('fldMeshWizUser').value || '').trim();
        const pass = get('fldMeshWizPass').value || '';
        const errEl = get('divMeshWizErr');
        errEl.textContent = '';
        if (!ip) { errEl.textContent = tr('MESH_NEED_IP') || 'Enter the Router IP.'; return; }
        if (!pass) { errEl.textContent = tr('MESH_NEED_PASS') || 'Enter the Router login password (set one on the Router first).'; return; }
        putJSONSync('/mesh/role', { role: 2, routerIp: ip, routerId: this._routerId || '', user, pass }, (err) => {
            if (err) { errEl.textContent = tr('MESH_PAIR_FAIL') || 'Pair failed. Check IP and password.'; return; }
            document.documentElement.setAttribute('data-mesh-role', 'repeater');
            get('divMeshWizard').style.display = 'none';
            if (this._heardTimer) clearInterval(this._heardTimer);
            general.showRebootWait();
            putJSONSync('/reboot', {}, () => {});
        });
    }
    loadState() {
        getJSON('/mesh/state', (err, st) => {
            if (err || !st) return;
            this.state = st;
            this.render();
            if (st.otaFollow || (st.peers || []).some(p => p.phase === 'flashing' || p.phase === 'rebooting')) this.watchOta();
        });
    }
    render() {
        const st = this.state;
        const peers = st.peers || [];
        this.renderSlaves(peers);
        if (typeof somfy !== 'undefined' && somfy.refreshMeshGlance) somfy.refreshMeshGlance();
        this.renderSummary(st);
        const list = get('divMeshPeerList');
        const empty = get('divMeshPeerEmpty');
        if (list) {
            if (!list.querySelector('.mesh-peer-name:focus')) {
                const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
                list.innerHTML = peers.map((p, i) => {
                    const sh = (p.shades || []).join(', ');
                    const slot = p.slot || (i + 1);
                    const host = String(p.hostname || '').replace(/"/g, '&quot;');
                    const routerFw = (get('spanFwVersion')?.innerText || '').trim();
                    const behind = p.fw && routerFw && p.fw !== routerFw;
                    const phase = p.phase || 'idle';
                    const phaseLbl = {
                        queued: tr('MESH_OTA_QUEUED') || 'Queued',
                        flashing: tr('MESH_OTA_FLASHING') || 'Flashing',
                        rebooting: tr('MESH_OTA_REBOOTING') || 'Rebooting',
                        done: tr('MESH_OTA_DONE') || 'Up to date',
                        failed: tr('MESH_OTA_FAILED') || 'Update failed'
                    }[phase];
                    const online = !!p.online;
                    const statusLbl = online ? (tr('MESH_ONLINE') || 'Online') : (tr('MESH_OFFLINE') || 'Offline');
                    const fwLbl = behind
                        ? `${tr('MESH_FW_BEHIND') || 'Needs update'} · ${esc(p.fw || '')} → ${esc(routerFw)}`
                        : `${esc(p.fw || '—')} · ${tr('MESH_FW_CURRENT') || 'Up to date'}`;
                    const otaBusy = phaseLbl && phase !== 'idle' && phase !== 'done';
                    const otaFail = phase === 'failed';
                    const otaHtml = (otaBusy || otaFail)
                        ? `<div class="mesh-peer-ota${otaFail ? ' is-fail' : ''}">${esc(phaseLbl)}${p.otaError ? ' · ' + esc(p.otaError) : ''}</div>`
                        : '';
                    const heard = (p.lastAddr && typeof p.rssi === 'number' && p.rssi > -127)
                        ? `${tr('MESH_LAST_HEARD') || 'Last heard'} ${esc(p.lastAddr)} · ${p.rssi} dBm`
                        : '';
                    const details = [
                        p.mac ? `MAC ${esc(p.mac)}` : '',
                        `heap ${p.heap || 0}`,
                        sh ? `shades ${esc(sh)}` : '',
                        heard
                    ].filter(Boolean).join(' · ');
                    return `<article class="mesh-peer-card${online ? ' is-online' : ' is-offline'}${behind ? ' is-behind' : ''}">
                        <div class="mesh-peer-top">
                            <span class="mesh-peer-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#svg-repeater"></use></svg></span>
                            <div class="mesh-peer-main">
                                <div class="mesh-peer-title">
                                    <span class="mesh-peer-slot">${esc((tr('MESH_RANK_SLAVE') || 'Slave %1').replace('%1', slot))}</span>
                                    <span class="mesh-badge ${online ? 'is-online' : 'is-offline'}">${esc(statusLbl)}</span>
                                </div>
                                <input id="fldMeshPeer${slot}" class="inputAndSelect mesh-peer-name" maxlength="32" data-id="${p.id}" value="${host}" placeholder="${esc(tr('GENERAL_HOSTNAME') || 'Hostname')}" onchange="mesh.renamePeer(this)">
                                <div class="mesh-peer-ip">${esc(meshIp(p.ip))}</div>
                            </div>
                        </div>
                        <div class="mesh-peer-fw${behind ? ' is-behind' : ''}">${fwLbl}</div>
                        ${otaHtml}
                        ${details ? `<div class="mesh-peer-details">${details}</div>` : ''}
                        <div class="mesh-peer-actions button-container-row">
                            <button type="button" ${online && behind ? '' : 'line '}onclick="mesh.pushUpdate('${p.id}')">${tr('MESH_UPDATE') || 'Update'}</button>
                            <button type="button" line onclick="mesh.unpair('${p.id}')">${tr('MESH_UNPAIR') || 'Unpair'}</button>
                        </div>
                    </article>`;
                }).join('');
            }
            if (empty) empty.style.display = peers.length ? 'none' : '';
        }
        this.renderRoomRadios(st);
        this.renderRanks(st);
        const ipFld = get('fldMeshRouterIp');
        if (ipFld && document.activeElement !== ipFld && st.routerIp) ipFld.value = meshIp(st.routerIp);
        const host = get('spanMeshRouterHost');
        if (host) {
            get('spanMeshRouterHost').textContent = st.routerHost || '--';
            get('spanMeshRouterIp').textContent = meshIp(st.routerIp);
            get('spanMeshRouterOnline').textContent = st.routerOnline ? (tr('MESH_ONLINE') || 'Online') : (tr('MESH_OFFLINE') || 'Offline');
            get('spanMeshRouterId').textContent = st.routerId || '--';
        }
    }
    renderSummary(st) {
        const box = get('divMeshSummary');
        if (!box) return;
        const peers = st.peers || [];
        const online = peers.filter(p => p.online).length;
        const roomIds = new Set();
        if (typeof _rooms !== 'undefined' && Array.isArray(_rooms)) {
            _rooms.forEach(r => { if (r && Number(r.roomId) > 0) roomIds.add(Number(r.roomId)); });
        }
        (st.rooms || []).forEach(r => { if (r && Number(r.roomId) > 0) roomIds.add(Number(r.roomId)); });
        const rooms = roomIds.size;
        const ranks = (st.ranks || []).length;
        const behind = peers.filter(p => {
            const routerFw = (get('spanFwVersion')?.innerText || '').trim();
            return p.fw && routerFw && p.fw !== routerFw;
        }).length;
        const chip = (icon, label, value, tone) =>
            `<div class="mesh-summary-chip${tone ? ' is-' + tone : ''}"><span class="mesh-summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#${icon}"></use></svg></span><div><strong>${value}</strong><span>${label}</span></div></div>`;
        const peerLbl = tr('MESH_SUMMARY_PEERS') || 'Online';
        const roomLbl = tr('MESH_SUMMARY_ROOMS') || 'Rooms';
        const rankLbl = tr('MESH_SUMMARY_RANKS') || 'Ranks';
        const updLbl = tr('MESH_SUMMARY_UPDATES') || 'Updates';
        box.innerHTML = [
            chip('svg-repeater', peerLbl, `${online}/${peers.length || 0}`, online ? 'ok' : (peers.length ? 'warn' : '')),
            chip('svg-emptyRoom', roomLbl, String(rooms), ''),
            chip('svg-tabRadio', rankLbl, String(ranks), ''),
            behind ? chip('svg-update', updLbl, String(behind), 'warn') : ''
        ].filter(Boolean).join('');
        const peerCount = get('spanMeshPeerCount');
        if (peerCount) peerCount.textContent = peers.length ? String(peers.length) : '';
        const roomCount = get('spanMeshRoomCount');
        if (roomCount) roomCount.textContent = rooms ? String(rooms) : '';
        const rankCount = get('spanMeshRankCount');
        if (rankCount) rankCount.textContent = ranks ? String(ranks) : '';
    }
    surveyRoomName(s) {
        const rid = Number(s.roomId);
        if (rid) {
            const lists = [];
            if (typeof _rooms !== 'undefined' && _rooms) lists.push(_rooms);
            if (typeof somfy !== 'undefined' && Array.isArray(somfy.rooms)) lists.push(somfy.rooms);
            for (const list of lists) {
                const r = list.find(x => Number(x.roomId) === rid);
                if (r && r.name) return String(r.name);
            }
        }
        const el = document.querySelector(`.somfyShade[data-shadeid="${s.shadeId}"] .cfg-room`);
        return el ? el.textContent.trim() : '';
    }
    shadeLabel(shadeId) {
        const s = (typeof somfy !== 'undefined' && Array.isArray(somfy.shades))
            ? somfy.shades.find(x => Number(x.shadeId) === Number(shadeId)) : null;
        if (!s) return `#${shadeId}`;
        const room = this.surveyRoomName(s);
        const name = String(s.name || shadeId);
        return room ? `${room} — ${name}` : name;
    }
    radioLabel(idx, peers) {
        if (idx === 0) return tr('MESH_RANK_THIS') || 'This unit';
        const p = (peers || []).find(x => Number(x.slot) === idx) || (peers || [])[idx - 1];
        const slot = (p && p.slot) || idx;
        const host = p ? (p.hostname || p.id || '') : '';
        const slave = (tr('MESH_RANK_SLAVE') || 'Slave %1').replace('%1', slot);
        return host ? `${slave} · ${host}` : slave;
    }
    renderRoomRadios(st) {
        const rl = get('divMeshRoomRadios');
        if (!rl) return;
        if (rl.querySelector('select:focus')) return;
        const peers = st.peers || [];
        const assigned = {};
        const picks = {};
        (st.rooms || []).forEach(r => {
            assigned[Number(r.roomId)] = (r.radio == null ? 255 : Number(r.radio));
            picks[Number(r.roomId)] = Number(r.pick) || 0;
        });
        const rooms = [];
        if (typeof _rooms !== 'undefined' && Array.isArray(_rooms)) {
            _rooms.forEach(r => { if (r && Number(r.roomId) > 0) rooms.push(r); });
        }
        (st.rooms || []).forEach(r => {
            if (!r || !Number(r.roomId)) return;
            if (!rooms.some(x => Number(x.roomId) === Number(r.roomId))) rooms.push(r);
        });
        if (!rooms.length) {
            rl.innerHTML = `<div class="empty-desc">${tr('MESH_NO_ROOMS') || 'Add rooms on the Somfy tab, then assign a radio here.'}</div>`;
            return;
        }
        const radios = [
            { idx: 255, label: tr('MESH_RADIO_AUTO') || 'Auto (best radio)' },
            { idx: 0, label: tr('MESH_RANK_THIS') || 'This unit' }
        ].concat(peers.map((p, i) => {
            const idx = Number(p.slot) || (i + 1);
            return { idx, label: this.radioLabel(idx, peers) };
        }));
        const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const usingLbl = tr('MESH_RANK_USING') || 'using';
        rl.innerHTML = rooms.map(r => {
            const rid = Number(r.roomId);
            const sel = assigned[rid] != null ? assigned[rid] : 255;
            const opts = radios.map(x =>
                `<option value="${x.idx}"${Number(x.idx) === Number(sel) ? ' selected' : ''}>${esc(x.label)}</option>`
            ).join('');
            const pick = picks[rid];
            const using = (sel === 255 || (sel > 0 && pick !== sel))
                ? `<div class="mesh-room-using">${esc(usingLbl)} · ${esc(this.radioLabel(pick, peers))}</div>`
                : '';
            const mode = sel === 255 ? 'auto' : (sel === 0 ? 'router' : 'slave');
            return `<div class="mesh-room-row" data-mode="${mode}">
                <span class="mesh-room-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#svg-emptyRoom"></use></svg></span>
                <div class="mesh-room-copy">
                    <div class="mesh-room-name">${esc(r.name || ('Room ' + rid))}</div>
                    ${using}
                </div>
                <div class="mesh-room-controls">
                    <select class="inputAndSelect" aria-label="${esc(r.name || ('Room ' + rid))}" onchange="mesh.setRoomRadio(${rid}, this.value)">${opts}</select>
                </div>
            </div>`;
        }).join('');
    }
    setRoomRadio(roomId, radio) {
        putJSON('/mesh/roomRadio', { roomId: Number(roomId), radio: Number(radio) }, (err, st) => {
            if (err) return ui.serviceError(err);
            if (st) { this.state = st; this.render(); }
        });
    }
    rssiTone(v, minRssi) {
        if (typeof v !== 'number' || v <= -127) return '';
        if (v >= -70) return 'good';
        if (v >= minRssi) return 'mid';
        return 'poor';
    }
    renderRanks(st) {
        const rl = get('divMeshRankList');
        if (!rl) return;
        const openIds = new Set(
            Array.from(rl.querySelectorAll('details.mesh-rank-card[open]'))
                .map(el => el.getAttribute('data-shadeid'))
                .filter(Boolean)
        );
        const ranks = st.ranks || [];
        const peers = st.peers || [];
        const radios = [0].concat(peers.map((p, i) => Number(p.slot) || (i + 1)));
        if (!ranks.length) {
            rl.innerHTML = `<div class="empty-desc">${tr('MESH_NO_RANKS') || 'No ranks yet. Press a linked remote.'}</div>`;
            return;
        }
        const none = tr('MESH_RANK_NONE') || 'no signal';
        const bestLbl = tr('MESH_RANK_BEST') || 'best';
        const minRssi = typeof st.minRssi === 'number' ? st.minRssi : -85;
        const weakLbl = tr('MESH_RANK_WEAK') || 'too weak';
        const moreLbl = tr('MESH_RANK_DETAILS') || 'All radios';
        rl.innerHTML = ranks.map(r => {
            const rssi = r.rssi || [];
            const pick = Number(r.pick) || 0;
            const want = r.want != null ? Number(r.want) : pick;
            const pickV = rssi[pick];
            const pickHeard = typeof pickV === 'number' && pickV > -127;
            const bestText = `${this.radioLabel(pick, peers)}${pickHeard ? ` · ${pickV} dBm` : ''}`;
            const open = openIds.has(String(r.shadeId)) ? ' open' : '';
            const rows = radios.map(idx => {
                const v = rssi[idx];
                const heard = typeof v === 'number' && v > -127;
                const useful = typeof v === 'number' && v >= minRssi;
                const best = idx === pick && (idx === 0 || useful);
                const dead = useful && idx === want && want !== pick;
                let mark = '';
                if (dead) mark = tr('MESH_RANK_OFFLINE') || 'offline';
                else if (best && idx === 0 && !useful) mark = tr('MESH_RANK_DEFAULT') || 'default';
                else if (best) mark = bestLbl;
                else if (heard && !useful) mark = weakLbl;
                const tone = this.rssiTone(v, minRssi);
                return `<div class="mesh-rank-radio${best ? ' is-best' : ''}${dead ? ' is-offline' : ''}">
                    <span class="mesh-rank-radio-name">${this.radioLabel(idx, peers)}</span>
                    <span class="mesh-rank-radio-rssi${tone ? ' mesh-rssi-' + tone : ''}">${heard ? (v + ' dBm') : none}</span>
                    ${mark ? `<span class="mesh-rank-radio-mark">${mark}</span>` : ''}
                </div>`;
            }).join('');
            return `<details class="mesh-rank-card"${open} data-shadeid="${r.shadeId}">
                <summary class="mesh-rank-summary">
                    <span class="mesh-rank-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#svg-simpleShutter"></use></svg></span>
                    <span class="mesh-rank-name">${this.shadeLabel(r.shadeId)}</span>
                    <span class="mesh-rank-best">${bestText}</span>
                    <svg class="mesh-panel-chevron" viewBox="0 0 24 24" aria-hidden="true"><use href="#svg-arrowDown"></use></svg>
                </summary>
                <div class="mesh-rank-body">
                    <div class="mesh-rank-body-label">${moreLbl}</div>
                    ${rows}
                </div>
            </details>`;
        }).join('');
    }
    renderSlaves(peers) {
        const box = get('divMeshSlaves');
        if (!box) return;
        const role = document.documentElement.getAttribute('data-mesh-role');
        const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const tipLines = (...rows) => rows.filter(Boolean).join('\n');
        const icon = (on, blink, tip) =>
            `<span class="mesh-slave-wrap"><span class="mesh-slave${on ? ' online' : ''}${blink ? ' mesh-slave-blink' : ''}" aria-label="${esc(tip.split('\n')[0] || 'Mesh')}"><svg viewBox="0 0 24 24"><use href="#svg-repeater"></use></svg></span><span class="status-tip">${esc(tip)}</span></span>`;
        if (role === 'repeater') {
            const st = this.state || {};
            const on = !!st.routerOnline;
            const prev = this._slaveHb || {};
            const blink = on && st.routerHb && st.routerHb !== prev.router;
            const tip = tipLines(
                tr('MESH_ROUTER') || 'Router',
                st.routerHost || st.routerId || '',
                st.routerIp ? meshIp(st.routerIp) : '',
                on ? (tr('MESH_ONLINE') || 'Online') : (tr('MESH_OFFLINE') || 'Offline')
            );
            box.classList.add('has-peers');
            box.innerHTML = icon(on, blink, tip);
            this._slaveHb = { router: st.routerHb };
            return;
        }
        if (role !== 'router' || !peers.length) {
            box.classList.remove('has-peers');
            box.innerHTML = '';
            this._slaveHb = {};
            return;
        }
        const prev = this._slaveHb || {};
        box.classList.add('has-peers');
        box.innerHTML = peers.map((p, i) => {
            const on = !!p.online;
            const blink = on && p.hb && p.hb !== prev[p.id];
            const tip = tipLines(
                `${tr('MESH_RANK_SLAVE') ? tr('MESH_RANK_SLAVE').replace('%1', p.slot || (i + 1)) : `Slave ${p.slot || (i + 1)}`}`,
                p.hostname || p.id || '',
                meshIp(p.ip),
                on ? (tr('MESH_ONLINE') || 'Online') : (tr('MESH_OFFLINE') || 'Offline'),
                p.fw || ''
            );
            return icon(on, blink, tip);
        }).join('');
        this._slaveHb = {};
        peers.forEach(p => { this._slaveHb[p.id] = p.hb; });
    }
    resetRanks() {
        putJSON('/mesh/resetRanks', {}, (err, st) => {
            if (err) return ui.serviceError(err);
            if (st) { this.state = st; this.render(); }
        });
    }
    unpair(id) {
        putJSON('/mesh/unpair', { id }, (err, st) => {
            if (err) return ui.serviceError(err);
            if (st) { this.state = st; this.render(); }
        });
    }
    pushUpdate(id) {
        putJSON('/mesh/pushUpdate', { peer: id || 'all', ver: 'current', now: true }, (err, st) => {
            if (err) return ui.serviceError(err);
            this.watchOta();
            this.loadState();
        });
    }
    pushUpdateAll() { this.pushUpdate('all'); }
    watchOta() {
        if (this._otaTimer) return;
        this._otaTimer = setInterval(() => {
            getJSON('/mesh/state', (err, st) => {
                if (err || !st) return;
                this.state = st;
                this.render();
                const busy = (st.peers || []).some(p => p.phase === 'flashing' || p.phase === 'rebooting' || p.phase === 'queued');
                if (!busy && !st.otaFollow) {
                    clearInterval(this._otaTimer);
                    this._otaTimer = null;
                }
            });
        }, 2500);
    }
    renamePeer(el) {
        const id = el.getAttribute('data-id');
        const hostname = (el.value || '').trim();
        const prev = ((this.state.peers || []).find(p => p.id === id) || {}).hostname || '';
        if (!hostname || !/^[a-zA-Z0-9-]+$/.test(hostname) || hostname.length > 32) {
            el.value = prev;
            ui.errorMessage(tr('ERR_HOSTNAME')).querySelector('.sub-message').innerHTML = tr('ERR_HOSTNAME_CHARS');
            return;
        }
        putJSON('/mesh/peerName', { id, hostname }, (err, st) => {
            if (err) {
                el.value = prev;
                return ui.serviceError(err);
            }
            if (st) { this.state = st; this.render(); }
        });
    }
    repair() {
        const ip = (get('fldMeshRouterIp').value || '').trim();
        const user = (get('fldMeshRouterUser').value || '').trim();
        const pass = get('fldMeshRouterPass').value || '';
        if (!ip) return ui.serviceError(tr('MESH_NEED_IP') || 'Enter the Router IP.');
        putJSON('/mesh/role', { role: 2, routerIp: ip, routerId: this.state.routerId || '', user, pass }, (err) => {
            if (err) return ui.serviceError(err);
            this.loadState();
        });
    }
    activityDevice(frame, dir) {
        if (frame && frame.src) return frame.src;
        if (dir === 'TX') {
            const pick = Number(frame && frame.pick);
            if (pick > 0) {
                const peers = (this.state && this.state.peers) || [];
                const p = peers.find(x => Number(x.slot) === pick) || peers[pick - 1];
                const host = p ? (p.hostname || p.id || '') : '';
                return host ? `Slave ${pick} · ${host}` : `Slave ${pick}`;
            }
            return tr('MESH_RANK_THIS') || 'This unit';
        }
        return tr('MESH_RANK_THIS') || 'This unit';
    }
    activityShade(frame) {
        const addr = Number(frame && frame.address);
        if (!addr) return '';
        const shades = (typeof somfy !== 'undefined' && Array.isArray(somfy.shades)) ? somfy.shades : [];
        for (const s of shades) {
            if (!s || s.shadeId == null) continue;
            if (Number(s.remoteAddress) === addr) return this.shadeLabel(s.shadeId);
            const linked = s.linkedRemotes || [];
            for (const r of linked) {
                if (r && Number(r.remoteAddress) === addr) return this.shadeLabel(s.shadeId);
            }
        }
        const groups = (typeof somfy !== 'undefined' && Array.isArray(somfy.groups)) ? somfy.groups : [];
        for (const g of groups) {
            if (!g || Number(g.remoteAddress) !== addr) continue;
            const room = this.surveyRoomName(g);
            const name = String(g.name || g.groupId || addr);
            return room ? `${room} — ${name}` : name;
        }
        return '';
    }
    activityDeviceHtml(frame, dir, esc) {
        const raw = this.activityDevice(frame, dir) || '';
        const sep = ' · ';
        const i = raw.indexOf(sep);
        const role = i > 0 ? raw.slice(0, i) : raw;
        const host = i > 0 ? raw.slice(i + sep.length) : '';
        if (!role) return '—';
        const rl = role.toLowerCase();
        const kind = rl.startsWith('slave') ? 'slave' : (rl.startsWith('router') ? 'router' : 'this');
        const chip = `<span class="mesh-role mesh-role-${kind}">${esc(role)}</span>`;
        return host ? `${chip}<span class="mesh-device-host">${esc(host)}</span>` : chip;
    }
    rssiClass(rssi) {
        if (rssi >= -60) return 'mesh-rssi-good';
        if (rssi >= -85) return 'mesh-rssi-mid';
        return 'mesh-rssi-poor';
    }
    logFrame(dir, frame) {
        const list = get('divMeshFrames');
        if (!list) return;
        const dt = new Date();
        const timeStr = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}:${dt.getSeconds().toString().padStart(2, '0')}`;
        const cmd = frame.cmd || frame.command || '';
        const row = document.createElement('div');
        row.className = 'frame-row mesh-frame-row';
        const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const device = this.activityDevice(frame, dir);
        const shade = this.activityShade(frame);
        const dirClass = dir === 'TX' ? 'mesh-dir mesh-dir-tx' : 'mesh-dir mesh-dir-rx';
        const rssiOk = frame.rssi != null && frame.rssi > -127;
        const rssiHtml = rssiOk ? `<span class="${this.rssiClass(frame.rssi)}">${frame.rssi}</span>` : '<span></span>';
        row.innerHTML = `<span class="${dirClass}">${dir}</span><span class="frame-src mesh-device" title="${esc(device)}">${this.activityDeviceHtml(frame, dir, esc)}</span><span class="frame-src" title="${esc(shade)}">${esc(shade) || '—'}</span><span>${frame.address || ''}</span><span>${esc(cmd)}</span>${rssiHtml}<span title="${timeStr}">${timeStr}</span>`;
        list.prepend(row);
        while (list.children.length > 80) list.removeChild(list.lastChild);
        this.refreshActivityChrome();
    }
    clearActivity() {
        const list = get('divMeshFrames');
        if (list) list.innerHTML = '';
        this.refreshActivityChrome();
    }
    refreshActivityChrome() {
        const list = get('divMeshFrames');
        const empty = get('divMeshActivityEmpty');
        const count = get('spanMeshActivityCount');
        const n = list ? list.children.length : 0;
        if (empty) empty.style.display = n ? 'none' : '';
        if (count) count.textContent = n ? String(n) : '';
        const log = list && list.closest('.mesh-activity-log');
        if (log) log.classList.toggle('is-empty', !n);
    }
}
var mesh = new MeshUi();
