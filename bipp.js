const ApiConst = {
  VERSION: '1.0.7',
  INIT: 'init',
  ADD_FILTER: 'addFilter',
  REMOVE_FILTER: 'removeFilter',
  DECORATE: 'decorate',
  OPTIONS: 'options',
  MSG_PREFIX: 'Bipp Embedded SDK:',
  WAIT_PERIOD_SECONDS: 5,
};

(function () {
  const SDK_Error = ApiConst.MSG_PREFIX + ' Error';

  class Bipp {

    constructor(args) {

      this.config = null;
      this.auth_done = false;
      this.auth_detail = null;
      this.iframe = null;
      this.server = null;
      this.url = null;
      this.resourceId = null;
      this.signed_url = null;
      
      this.lastLoginTime = null;
      if (args) {
        this.debug = args.debug;
      }

      console.log(`${ApiConst.MSG_PREFIX} Version ${ApiConst.VERSION}`);

      window.addEventListener('message', this.messageHandler.bind(this));
    }
    
    getResourceId(url) {
      let toks = url.split('/dashboards/');
      if (toks.length > 1) {
        let result = toks[1];
        result = result.split("?");
        return result[0];
      }
      return null;
    }

    messageHandler(e) {
      const { type, from } = e.data;

      if (type == 'sendAuth') {
        if (this.resourceId == from) {
          this.sendAuthDetails();
        }
      }
      else if (type == 'relogin') {
        if (this.resourceId == from) {
          this.reLogin();
        }
      }
    }

    log(...args) {
      if (this.debug) {
        console.log("BippSDK", this.url, args);
      }
    }

    async reLogin() {

      if (!this.lastLoginTime) {
        this.lastLoginTime = new Date().getTime();
      } else if (
        (new Date().getTime() - this.lastLoginTime) / 1000 <
        ApiConst.WAIT_PERIOD_SECONDS
      ) {
        // do not send multiple login requests
        return;
      }
      this.log('doing relogin...')
      this.lastLoginTime = new Date().getTime();
      this.auth_done = false;
      await this.load();
    }

    error(e) {
      console.error(`${ApiConst.MSG_PREFIX} ${e}`);
    }

    async login() {
      const { app_id, client_id, client_secret } = this.auth_detail;

      const headers = {
        'X-Org-ID': 'dummy',
      };
      const data = {
        app_id,
        client_id,
        client_secret,
      };

      const url = `${this.server}/app/v1/extapps/${app_id}/login`;

      try {
        const res = await axios
          .post(url, data, {
            headers,
          });

        if (res) {
          this.auth_detail.paymentToken = res.data.subscription;
          this.auth_detail.app_token = res.data.app_token;
          this.auth_detail.org_id = res.data.org_id;

          return await this.setEmbedToken();
        }
      }
      catch (error) {
        this.error(`unable to login, ${error}`);
      }
      return false;
    }

    async setEmbedToken() {
      const { paymentToken, app_token, org_id } = this.auth_detail;

      const headers = {
        'X-Org-ID': org_id,
        'X-Payment-Token': paymentToken,
        Authorization: `Bearer ${app_token}`,
      };

      try {
        const res = await axios
          .get(this.signed_url, {
            headers,
          });

        if (res) {
          this.url = res.data.url;
          this.resourceId = this.getResourceId(this.url);
          this.auth_detail.embedToken = res.data.embed_token;
          return true;
        }
      }
      catch(error) {
        this.error(`unable to get embed token. ${error}`);
      }
      return false;
    }

    getFieldValue(str, field) {
      let toks = str.split(`${field}=`)
      if (toks.length == 2) {
        return toks[1];
      }
      else {
        return null;
      }
    }

    // https://subdomain.bipp.io/embed/<link_id>?id=<app_id>&cid=<client_id>&secret=<client_secret>

    parse(url, config) {

      this.config = config;
      let toks = url.split("?");

      if (toks.length != 2) return false;

      const embed_url = toks[0];
      this.signed_url = embed_url;

      if (embed_url.indexOf("/embed") <= 0) return false;

      this.server = embed_url.split("/embed")[0]

      const args = toks[1];

      toks = args.split("&");
      if (toks.length < 3) return false;

      const app_id = this.getFieldValue(toks[0], 'id');
      if (!app_id) return false;

      const client_id = this.getFieldValue(toks[1], 'cid');
      if (!client_id) return false;
      
      const client_secret = this.getFieldValue(toks[2], 'secret');
      if (!client_secret) return false;
      
      this.auth_detail = {
        app_id,
        client_id,
        client_secret
      }
      return true;
    }

    sendAuthDetails() {
      if (!this.auth_done && this.auth_detail) {
        this.auth_done = true;
        this.log('sending authdetails');
        this.iframe.contentWindow.postMessage(
          {
            type: ApiConst.INIT,
            payload: { authToken: this.auth_detail, config : this.config},
          },
          '*'
        );
      }
      else {
        this.log('authdetails already sent')
      }
    }

    async load(url, config) {

      if (!this.server) { // First load
        if (!this.parse(url, config)) {
          this.error(`invalid embed url ${url}`);
          return
        }
      }
      
      const { id, width = '600px', height='400px', style = ''} = this.config;

      if (!id) throw `${SDK_Error} ${sign}, missing id in config`;

      const res = await this.login();
      if (!res) {
        this.log('login failed');
        return;
      }
      this.log('login completed');

      this.element = document.getElementById(id);

      if (this.iframe && this.element.contains(this.iframe)) {
        this.element.removeChild(this.iframe);
      }

      let iframe = document.createElement('iframe');
      this.iframe = iframe;

      iframe.width = width;
      iframe.height = height;
      iframe.style = style;
      iframe.src = this.url;

      this.element.appendChild(iframe);

      iframe.onload = () => {
        this.log('onload complete');
      };
    }

    addFilter(filters) {
      filters.forEach((e) => {
        if (!e.table || !e.column || !e.value)
          throw `${SDK_Error} invalid filter`;
      });

      if (this.iframe) {
        this.iframe.contentWindow.postMessage(
          {
            type: ApiConst.ADD_FILTER,
            payload: filters,
          },
          '*'
        );
      }
    }

    removeFilter(filters) {
      filters.forEach((e) => {
        if (!e.table || !e.column) throw `${SDK_Error} invalid filter`;
      });

      if (this.iframe) {
        this.iframe.contentWindow.postMessage(
          {
            type: ApiConst.REMOVE_FILTER,
            payload: filters,
          },
          '*'
        );
      }
    }

    setOptions(args) {
      if (this.iframe) {
        this.iframe.contentWindow.postMessage(
          {
            type: ApiConst.OPTIONS,
            payload: args,
          },
          '*'
        );
      }
    }

    // experimental
    decorate(args) {
      if (this.iframe) {
        this.iframe.contentWindow.postMessage(
          {
            type: ApiConst.DECORATE,
            payload: args,
          },
          '*'
        );
      }
    }
  }
  window.Bipp = Bipp;
})();
