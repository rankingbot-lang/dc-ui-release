// ==UserScript==
// @name         디시인사이드 UI 변경
// @namespace    https://gall.dcinside.com
// @version      2.0.9
// @description  갤러리 UI 변경, 즐겨찾기·최근 방문 갤러리 UI개선, 단축키, 대문 보이기/숨기기, 개념글 알림, 광고 숨김 등
// @author       rankingbot
// @license      MIT
// @homepageURL  https://sleazyfork.org/ko/scripts/581303
// @icon         https://nstatic.dcinside.com/dc/w/images/logo_icon.ico
// @match        https://gall.dcinside.com/*/board/lists*
// @match        https://gall.dcinside.com/board/lists*
// @match        https://gall.dcinside.com/*/board/view*
// @match        https://gall.dcinside.com/board/view*
// @resource     dcui-fontawesome https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.6.0/fonts/fontawesome-webfont.woff2#sha256=c1732796c9dfafddff16db9660e67a879d723f376b0160cccad730c6c414eed3
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_getResourceURL
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      m.dcinside.com
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_VERSION = "2.0.9";
  const THEME_ENABLED_KEY = "dcui:enabled";
  const LIST_SIZE_PREFERENCE_KEY = "dcui:list-size-preference";
  const SETTINGS_COLLAPSED_KEY = "dcui:settings-collapsed";
  const GALLERY_COVER_HIDDEN_KEY = "dcui:gallery-cover-hidden";
  const USER_IDENTIFIER_VISIBLE_KEY = "dcui:user-identifier-visible";
  const CONCEPT_ALARM_ENABLED_KEY = "dcui:concept-alarm-enabled";
  const NATIVE_ALARM_INSTALL_KEY = "dcui:native-alarm-install";
  const FAVORITE_SHORTCUT_CACHE_KEY = "dcui:favorite-shortcuts-cache";
  const FAVORITE_SHORTCUT_CACHE_READY_KEY = "dcui:favorite-shortcuts-cache-ready";
  const UI_CONFIG = Object.freeze({
    listSize: Object.freeze({
      defaultValue: "30",
      allowedValues: Object.freeze(["30", "50", "100"]),
    }),
  });
  const VALID_LIST_SIZES = new Set(UI_CONFIG.listSize.allowedValues);
  const PAGE_RE = /^\/(?:(mini|mgallery|person)\/)?board\/(lists|view)\/?$/;

  let configuredListSize = "";
  const ListSizeConfig = Object.freeze({
    normalize(value) {
      const normalized = String(value ?? "");
      return VALID_LIST_SIZES.has(normalized) ? normalized : "";
    },

    get() {
      if (configuredListSize) return configuredListSize;
      const savedSize = this.normalize(GM_getValue(LIST_SIZE_PREFERENCE_KEY, ""));
      configuredListSize = savedSize || UI_CONFIG.listSize.defaultValue;
      if (!savedSize) GM_setValue(LIST_SIZE_PREFERENCE_KEY, Number(configuredListSize));
      return configuredListSize;
    },

    set(value) {
      const normalized = this.normalize(value);
      if (!normalized) return this.get();
      configuredListSize = normalized;
      GM_setValue(LIST_SIZE_PREFERENCE_KEY, Number(normalized));
      syncConfiguredListLinks();
      return configuredListSize;
    },

    apply(url) {
      url.searchParams.set("list_num", this.get());
      return url;
    },
  });

  function galleryBoardHref(rawHref, baseHref = location.href) {
    try {
      const url = new URL(rawHref, baseHref);
      const shortcut = url.pathname.match(/^\/(?:(mini|mgallery|person)\/)?([^/]+)\/?$/);
      if (url.origin === location.origin && shortcut) {
        const prefix = shortcut[1] ? `/${shortcut[1]}` : "";
        url.pathname = `${prefix}/board/lists/`;
        url.search = `?id=${encodeURIComponent(shortcut[2])}`;
      }
      if (url.origin !== location.origin || !/\/(?:(?:mini|mgallery|person)\/)?board\/(?:lists|view)\/?$/.test(url.pathname)) {
        return url.href;
      }
      return ListSizeConfig.apply(url).href;
    } catch (_error) {
      return String(rawHref || "");
    }
  }

  function syncConfiguredListLinks() {
    const selectors = [
      "#dcui-gallery-strip a[href]",
      "#dcui-sidebar .dcui-favorite-shortcut a[href]",
      "#dcui-sidebar [data-role='sideConcept'][href]",
      ".dcui-board-nav a[href]",
    ];
    document.querySelectorAll(selectors.join(",")).forEach((link) => {
      const normalizedHref = galleryBoardHref(link.href);
      if (normalizedHref !== link.href) link.href = normalizedHref;
    });
    const nativeListUrl = document.getElementById("list_url");
    if (nativeListUrl && "value" in nativeListUrl) {
      const normalizedValue = galleryBoardHref(nativeListUrl.value);
      if (normalizedValue && normalizedValue !== nativeListUrl.value) nativeListUrl.value = normalizedValue;
    }
  }

  const BoardNavigationController = Object.freeze({
    rawHrefFromControl(control) {
      if (control instanceof HTMLAnchorElement) return control.getAttribute("href") || "";
      const onclick = control?.getAttribute?.("onclick") || "";
      return onclick.match(/\bgoList\s*\(\s*(['"])(.*?)\1/)?.[2] || "";
    },

    navigate(event) {
      if (!document.documentElement.classList.contains("dcui-enabled")) return;
      if (event.type === "click" && event.button !== 0) return;
      if (event.type === "auxclick" && event.button !== 1) return;

      const control = event.target.closest?.("a[href], button[onclick*='goList']");
      if (!control || control.closest("#dcui-theme-toggle")) return;
      const rawHref = this.rawHrefFromControl(control);
      if (!rawHref || /^javascript:/i.test(rawHref) || rawHref.startsWith("#")) return;

      let originalUrl;
      try {
        originalUrl = new URL(rawHref, location.href);
      } catch (_error) {
        return;
      }
      if (originalUrl.origin !== location.origin || !PAGE_RE.test(originalUrl.pathname)) return;
      const normalizedHref = galleryBoardHref(originalUrl.href);
      if (normalizedHref === originalUrl.href) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const openInNewTab = event.type === "auxclick"
        || event.ctrlKey || event.metaKey || event.shiftKey
        || control.getAttribute("target") === "_blank";
      if (openInNewTab) window.open(normalizedHref, "_blank", "noopener");
      else location.assign(normalizedHref);
    },

    mount() {
      if (!initialThemeEnabled || window.__dcuiListNavigationBound) return;
      window.__dcuiListNavigationBound = true;
      document.addEventListener("click", (event) => this.navigate(event), true);
      document.addEventListener("auxclick", (event) => this.navigate(event), true);
    },
  });

  const PageContext = Object.freeze({
    fromLocation(currentLocation = location) {
      const match = currentLocation.pathname.match(PAGE_RE);
      if (!match) return null;

      const galleryType = match[1] === "mgallery" ? "minor" : (match[1] || "major");
      const galleryId = new URL(currentLocation.href).searchParams.get("id") || "unknown";
      const isRealtimeBest = galleryType === "major" && galleryId === "dcbest";
      const boardBasePath = currentLocation.pathname.replace(/(?:lists|view)\/?$/, "");
      const listUrl = new URL(`${boardBasePath}lists/`, currentLocation.origin);
      listUrl.searchParams.set("id", galleryId);
      ListSizeConfig.apply(listUrl);
      const conceptUrl = new URL(listUrl);
      conceptUrl.searchParams.set("exception_mode", "recommend");
      const noticeUrl = new URL(listUrl);
      noticeUrl.searchParams.set("exception_mode", "notice");
      const writeUrl = new URL(`${boardBasePath}write/`, currentLocation.origin);
      writeUrl.searchParams.set("id", galleryId);

      return Object.freeze({
        pageType: match[2] === "view" ? "view" : "list",
        galleryType,
        galleryId,
        galleryKey: `${galleryType}:${galleryId}`,
        isRealtimeBest,
        urls: Object.freeze({
          galleryHome: currentLocation.origin,
          list: listUrl.href,
          concept: conceptUrl.href,
          notice: noticeUrl.href,
          write: writeUrl.href,
        }),
      });
    },
  });

  const pageContext = PageContext.fromLocation();

  if (!pageContext) return;
  const initialThemeEnabled = GM_getValue(THEME_ENABLED_KEY, true) !== false;
  if (window.__dcuiInitialized) return;
  window.__dcuiInitialized = true;
  initializeNativeAlarmInstall();
  BoardNavigationController.mount();

  const earlyShield = initialThemeEnabled ? document.createElement("style") : null;
  let earlyShieldObserver = null;
  if (earlyShield) {
    earlyShield.id = "dcui-early-shield";
    earlyShield.textContent = "html.dcui-booting body{visibility:hidden!important}";
    const installEarlyShield = () => {
      if (!document.documentElement || earlyShield.isConnected) return false;
      document.documentElement.classList.add("dcui-booting");
      document.documentElement.appendChild(earlyShield);
      return true;
    };
    if (!installEarlyShield() && typeof MutationObserver === "function") {
      earlyShieldObserver = new MutationObserver(() => {
        if (!installEarlyShield()) return;
        earlyShieldObserver.disconnect();
        earlyShieldObserver = null;
      });
      earlyShieldObserver.observe(document, { childList: true, subtree: true });
    }
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  const AUTOMATED_REQUEST_PAUSED_KEY = "dcui:automated-request-paused";
  const AUTOMATED_REQUEST_LAST_AT_KEY = "dcui:automated-request-last-at";
  const AUTOMATED_REQUEST_NAVIGATION_AT_KEY = "dcui:navigation-last-at";
  const AUTOMATED_REQUEST_LOCK_NAME = "dcui:automated-request";
  let automatedRequestLifecycle = new AbortController();

  class EmptyAutomatedResponseError extends Error {
    constructor() {
      super("디시 자동 요청에서 빈 응답을 받았습니다.");
      this.name = "EmptyAutomatedResponseError";
    }
  }

  const AutomatedRequestCoordinator = Object.freeze({
    minGapMs: 5000,

    isPaused() {
      return GM_getValue(AUTOMATED_REQUEST_PAUSED_KEY, false) === true;
    },

    pauseOnEmpty() {
      GM_setValue(AUTOMATED_REQUEST_PAUSED_KEY, true);
    },

    resume() {
      GM_setValue(AUTOMATED_REQUEST_PAUSED_KEY, false);
      this.resetLifecycle();
    },

    noteNavigation() {
      GM_setValue(AUTOMATED_REQUEST_NAVIGATION_AT_KEY, Date.now());
    },

    lastNavigationAt() {
      return Number(GM_getValue(AUTOMATED_REQUEST_NAVIGATION_AT_KEY, 0)) || 0;
    },

    stopLifecycle() {
      automatedRequestLifecycle.abort();
    },

    resetLifecycle() {
      if (!automatedRequestLifecycle.signal.aborted) return;
      automatedRequestLifecycle = new AbortController();
    },

    signal() {
      return automatedRequestLifecycle.signal;
    },

    abortError() {
      return new DOMException("디시 자동 요청이 중지되었습니다.", "AbortError");
    },

    requireNonEmpty(value) {
      const text = String(value || "");
      if (text.trim()) return text;
      this.pauseOnEmpty();
      throw new EmptyAutomatedResponseError();
    },

    wait(delay, signal) {
      if (!(delay > 0)) return Promise.resolve();
      return new Promise((resolveWait, rejectWait) => {
        if (signal.aborted) {
          rejectWait(this.abortError());
          return;
        }
        const timer = window.setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolveWait();
        }, delay);
        const abort = () => {
          window.clearTimeout(timer);
          rejectWait(this.abortError());
        };
        signal.addEventListener("abort", abort, { once: true });
      });
    },

    async run(task, { force = false, shouldRun = null, navigationGapMs = this.minGapMs,
      automatedGapMs = this.minGapMs } = {}) {
      const signal = this.signal();
      const execute = async () => {
        if (signal.aborted) throw this.abortError();
        if (this.isPaused() && !force) throw new EmptyAutomatedResponseError();
        if (typeof shouldRun === "function" && !await shouldRun()) return undefined;
        const lastAt = Number(GM_getValue(AUTOMATED_REQUEST_LAST_AT_KEY, 0)) || 0;
        const now = Date.now();
        const automatedGap = Math.max(0, automatedGapMs - (now - lastAt));
        const navigationGap = Math.max(0, Number(navigationGapMs) - (now - this.lastNavigationAt()));
        await this.wait(Math.max(automatedGap, navigationGap), signal);
        if (signal.aborted) throw this.abortError();
        if (this.isPaused() && !force) throw new EmptyAutomatedResponseError();
        GM_setValue(AUTOMATED_REQUEST_LAST_AT_KEY, Date.now());
        return task(signal);
      };

      if (navigator.locks?.request) {
        return navigator.locks.request(
          AUTOMATED_REQUEST_LOCK_NAME,
          { mode: "exclusive", signal },
          execute,
        );
      }
      return execute();
    },
  });

  function initializeNativeAlarmInstall() {
    if (GM_getValue(NATIVE_ALARM_INSTALL_KEY, null) !== null) return;
    // Older releases have no install marker. Any existing userscript data means
    // an upgrade: never infer a new installation from the missing marker alone.
    const fresh = typeof GM_listValues === "function" && GM_listValues().length === 0;
    GM_setValue(NATIVE_ALARM_INSTALL_KEY, fresh ? "pending" : "preserved");
  }

  const NativeAlarmInstall = Object.freeze({
    async apply() {
      if (GM_getValue(NATIVE_ALARM_INSTALL_KEY, "preserved") !== "pending") return;
      const panel = document.getElementById("alarmConf");
      const rtbest = panel?.querySelector('.setting_onoff > button[data-id="rtbest"]');
      if (!rtbest) return;
      const preserveUserChoice = () => {
        if (GM_getValue(NATIVE_ALARM_INSTALL_KEY, "") === "pending") {
          GM_setValue(NATIVE_ALARM_INSTALL_KEY, "preserved");
        }
      };
      panel.addEventListener("click", preserveUserChoice, true);
      try {
        await AutomatedRequestCoordinator.run(async (signal) => {
          // Recheck after the shared request lock and delay, including other tabs.
          if (GM_getValue(NATIVE_ALARM_INSTALL_KEY, "") !== "pending" || !rtbest.isConnected) return;
          if (!rtbest.classList.contains("on")) {
            GM_setValue(NATIVE_ALARM_INSTALL_KEY, "already-off");
            return;
          }
          const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
          if (typeof page.jQuery?.ajax !== "function" || typeof page.get_cookie !== "function") return;
          const controls = [...panel.querySelectorAll(".setting_onoff > button")];
          const conf = Object.fromEntries(controls.map(node => [node.dataset.id, Number(node.classList.contains("on"))]));
          if (!["popup", "reply", "reReply", "pum"].every(key => key in conf)) return;
          conf.rtbest = 0;
          const data = { ci_t: page.get_cookie("ci_c"), conf };
          if (!data.ci_t) return;
          const cell = typeof page.rtb_get === "function" ? page.rtb_get("rtb_cell") : null;
          if (cell) {
            data.rtb_cell = cell;
            data.rtb_gt = page._GALLERY_TYPE_ || "";
          }
          // Persist before sending: an interrupted/failed save must not be
          // retried on every reload or overwrite a later manual preference.
          GM_setValue(NATIVE_ALARM_INSTALL_KEY, "saving");
          const buttons = [...panel.querySelectorAll("button")].map(node => ({ node, disabled: node.disabled }));
          buttons.forEach(({ node }) => { node.disabled = true; });
          try {
            await new Promise((resolveSave, rejectSave) => {
              const request = page.jQuery.ajax({
                url: "//gall.dcinside.com/ajax/alarm_ajax/conf_update?jsoncallback=?",
                type: "GET", cache: false, dataType: "json", data, timeout: 15000,
                success: (result) => {
                  try {
                    AutomatedRequestCoordinator.requireNonEmpty(result);
                    if (result !== "0000") throw new Error("실베 알림 설정 저장 실패");
                    resolveSave();
                  } catch (error) { rejectSave(error); }
                },
                error: (xhr, status) => {
                  try {
                    if (xhr.status > 0) AutomatedRequestCoordinator.requireNonEmpty(xhr.responseText);
                    throw new Error(`실베 알림 설정 저장 실패: ${status}`);
                  } catch (error) { rejectSave(error); }
                },
              });
              const abort = () => request.abort();
              signal.addEventListener("abort", abort, { once: true });
              request.always(() => signal.removeEventListener("abort", abort));
            });
            GM_setValue(NATIVE_ALARM_INSTALL_KEY, "saved");
            rtbest.classList.remove("on");
            const label = rtbest.querySelector(".blind");
            if (label) label.textContent = "off";
            if ("rtb_conf_prev" in page) page.rtb_conf_prev = 0;
          } catch (error) {
            GM_setValue(NATIVE_ALARM_INSTALL_KEY, "failed");
            throw error;
          } finally {
            buttons.forEach(({ node, disabled }) => { node.disabled = disabled; });
          }
        });
      } catch (error) {
        if (error.name !== "AbortError") console.warn("[DC UI] 실베 알림 초기 저장을 완료하지 못했습니다. 내 알림 > 설정에서 확인해 주세요.", error);
      } finally {
        panel.removeEventListener("click", preserveUserChoice, true);
      }
    },
  });

  const AdBlocker = Object.freeze({
    adNodeSelector: [
      "#ad-layer",
      "#ad-pop-layer",
      "#ad-layer-closer",
      "#ad-pop-layer-closer",
      ".banner_box:has(> script[src*='addc.dcinside.com/NetInsight/'])",
      ".banner_box:has(> a[href*='addc.dcinside.com'][href*='/click/dcinside/pc/list@top_'])",
      "script[src*='addc.dcinside.com/NetInsight/']",
      ".banner_box > a[href*='addc.dcinside.com'][href*='/click/dcinside/pc/list@top_']",
      ".con_banner.writing_banbox",
      ".stickyunit",
      "#gfp_sf_align > #ad-element",
      "#gfp_sf_align > .native_image_wrap",
      ".cm_ad[data-ad-node]",
      ".cm_ad.creative_ready",
      ".cm_ad[data-ad-node] > .link_ad",
      ".cm_ad[data-ad-node] > .icon_ad",
      ".view_ad_wrap > .power_link",
      ".cmt_list > li.power_link.cmt_power_link",
      ".kakao_ad_area",
      ".ad_bottom_list",
      ".google-auto-placed",
      "ins.adsbygoogle",
      "[id^='criteo-']",
      "[id^='google_ads_']",
      "[id^='div-gpt-ad']",
      "iframe[id^='ad_frame']",
      "iframe[src*='ad.xc.netinsight.co.kr']",
      "iframe[src*='ad.adnmore.co.kr']",
      "iframe[src*='doubleclick.net']",
      "iframe[src*='googlesyndication.com']",
      "script[src*='ad.xc.netinsight.co.kr']",
      "script[src*='static.criteo.net']",
      "script[src*='c.xc.netinsight.co.kr']",
      "script[src*='pagead2.googlesyndication.com']",
      "script[src*='t1.kakaocdn.net/kas/']",
      "script[src*='ssl.pstatic.net/tveta/']",
      "link[href*='ssl.pstatic.net/tveta/']",
      "script[src*='ad.adnmore.co.kr']",
    ].join(","),

    protectedContentSelector: [
      ".view_content_wrap",
      ".writing_view_box",
      ".write_div",
      ".gallview_contents",
      ".view_comment",
      ".cmt_wrap",
      ".dcui-comments",
      "table.gall_list",
    ].join(","),

    knownContainerSelector: [
      "#ad-layer",
      "#ad-layer-closer",
      ".banner_box:has(> script[src*='addc.dcinside.com/NetInsight/'])",
      ".banner_box:has(> a[href*='addc.dcinside.com'][href*='/click/dcinside/pc/list@top_'])",
      ".con_banner.writing_banbox",
      ".stickyunit",
      ".cm_ad[data-ad-node]",
      ".cm_ad.creative_ready",
      ".ad_bottom_list",
    ].join(","),

    containerFor(node) {
      const known = node.closest?.(this.knownContainerSelector);
      if (known) {
        const containsProtectedContent = known.matches(this.protectedContentSelector)
          || Boolean(known.querySelector(this.protectedContentSelector));
        if (containsProtectedContent && known !== node) return node;
        return known;
      }
      const criteo = node.matches?.("[id^='criteo-']") ? node : node.closest?.("[id^='criteo-']");
      if (criteo) return criteo;
      // 광고 스크립트가 들어온 시점에는 본문 컨테이너가 아직 비어 있을 수 있다.
      // 부모의 현재 내용만 보고 광고 래퍼로 승격하면 이후 채워질 본문까지 삭제하므로
      // 명시적으로 일치한 광고 노드 자체만 제거한다.
      return node;
    },

    removeFrom(root) {
      if (!(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)) return;
      const matches = [];
      if (root instanceof Element && root.matches(this.adNodeSelector)) matches.push(root);
      root.querySelectorAll?.(this.adNodeSelector).forEach((node) => matches.push(node));
      for (const node of [...new Set(matches)]) {
        if (!node.isConnected) continue;
        const target = this.containerFor(node);
        if (!target) continue;
        const containsProtectedContent = target.matches?.(this.protectedContentSelector)
          || Boolean(target.querySelector?.(this.protectedContentSelector));
        if (containsProtectedContent) continue;
        target.remove();
      }
    },

    mount() {
      if (!initialThemeEnabled || window.__dcuiAdBlockerMounted) return;
      window.__dcuiAdBlockerMounted = true;
      this.removeFrom(document);
      if (typeof MutationObserver !== "function") return;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => this.removeFrom(node));
        }
      });
      observer.observe(document, { childList: true, subtree: true });
      window.__dcuiAdBlockerObserver = observer;
    },
  });

  AdBlocker.mount();

  const DcAdapter = Object.freeze({
    query(selector, root = document) {
      return root.querySelector(selector);
    },

    queryAll(selector, root = document) {
      return Array.from(root.querySelectorAll(selector));
    },

    issueAnchor(root = document) {
      return this.query(".gall_issuebox .issue_gallinfo, #issue_setting, .gall_issuebox .issue_setting", root);
    },

    siteRoot(root = document) {
      return this.query("#top", root);
    },

    contentWrap(root = document) {
      return this.query("#top > .wrap_inner", root);
    },

    container(root = document) {
      return this.query("#container", root);
    },

    leftContent(root = document) {
      return this.query("#container > .left_content, #container > section:first-of-type", root);
    },

    rightContent(root = document) {
      return this.query("#container > .right_content", root);
    },

    searchWrap(root = document) {
      return this.query("#search_wrap", root);
    },

    galleryTitle(root = document) {
      return this.query(".page_head h2 a", root);
    },

    loginLink(root = document) {
      return this.query(".dcheader .btn_top_loginout", root);
    },

    logo(root = document) {
      return this.query(".dcheader .dc_logo", root);
    },

    loginBox(root = document) {
      return this.query("#login_box", root);
    },

    nativeAlarmLink(root = document) {
      return this.queryAll("#login_box .user_option a", root)
        .find((link) => cleanText(link.textContent).includes("알림")) || null;
    },

    nativeAlarmPanel(root = document) {
      return this.query("#alarmList", root);
    },

    ownGallogUrl(root = document) {
      const profileBase = (rawHref) => {
        try {
          const url = new URL(rawHref);
          if (url.hostname !== "gallog.dcinside.com") return "";
          const profileId = url.pathname.split("/").filter(Boolean)[0] || "";
          if (!/^[a-zA-Z0-9_-]+$/.test(profileId)) return "";
          return `https://gallog.dcinside.com/${profileId}`;
        } catch (_error) {
          return "";
        }
      };
      const directProfileBase = this.queryAll("#login_box a[href*='gallog.dcinside.com/']", root)
        .map((link) => profileBase(link.href))
        .find(Boolean) || "";
      if (directProfileBase) return directProfileBase;

      const gallogTrigger = this.query("#login_box .writer_nikcon", root);
      const triggerSource = gallogTrigger?.getAttribute("onclick") || gallogTrigger?.getAttribute("title") || "";
      const matchedId = triggerSource.match(/gallog\.dcinside\.com\/([a-zA-Z0-9_-]+)/)?.[1];
      return matchedId ? `https://gallog.dcinside.com/${matchedId}` : "https://gallog.dcinside.com/";
    },

    listRoot(root = document) {
      return this.query(".gall_listwrap", root);
    },

    listTable(root = document) {
      return this.query("table.gall_list", root);
    },

    postRows(root = document) {
      return this.queryAll("tr.ub-content[data-no]", root);
    },

    articleRoot(root = document) {
      return this.query(".view_content_wrap", root);
    },

    articleHeader(root = document) {
      return this.query(".gallview_head", root);
    },

    articleBody(root = document) {
      return this.query(".gallview_contents", root);
    },

    commentRoot(root = document) {
      return this.query("#focus_cmt.view_comment, .view_comment:not(.image_comment), .view_comment", root);
    },
  });

  const AnchoredPopupController = Object.freeze({
    openingClass(popupClass) {
      return popupClass === "dcui-relation-popup"
        ? "dcui-relation-popup-opening"
        : "";
    },

    armOpening(popupClass) {
      const className = this.openingClass(popupClass);
      if (!className) return;
      document.documentElement.classList.add(className);
      if (document.documentElement.__dcuiPopupOpeningTimer) {
        window.clearTimeout(document.documentElement.__dcuiPopupOpeningTimer);
      }
      document.documentElement.__dcuiPopupOpeningTimer = window.setTimeout(() => {
        document.documentElement.classList.remove(className);
        document.documentElement.__dcuiPopupOpeningTimer = 0;
      }, 10000);
    },

    clearOpening(popupClass) {
      const className = this.openingClass(popupClass);
      if (className) document.documentElement.classList.remove(className);
      if (document.documentElement.__dcuiPopupOpeningTimer) {
        window.clearTimeout(document.documentElement.__dcuiPopupOpeningTimer);
        document.documentElement.__dcuiPopupOpeningTimer = 0;
      }
    },

    isShown(popup) {
      if (!popup?.isConnected) return false;
      const style = getComputedStyle(popup);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) !== 0;
    },

    isVisiblyOpen(popup) {
      if (!this.isShown(popup)) return false;
      const rect = popup.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },

    rememberOrigin(popup) {
      if (popup.__dcuiAnchoredPopupOrigin) return;
      popup.__dcuiAnchoredPopupOrigin = {
        parent: popup.parentNode,
        nextSibling: popup.nextSibling,
        style: popup.getAttribute("style"),
      };
    },

    clearAlignmentTracking(popup) {
      for (const timer of popup?.__dcuiAnchoredPopupAlignmentTimers || []) {
        window.clearTimeout(timer);
      }
      if (popup) popup.__dcuiAnchoredPopupAlignmentTimers = [];
      popup?.__dcuiAnchoredPopupResizeObserver?.disconnect();
      if (popup) popup.__dcuiAnchoredPopupResizeObserver = null;
    },

    restoreOrigin(popup) {
      const origin = popup?.__dcuiAnchoredPopupOrigin;
      if (!origin?.parent?.isConnected || !popup.isConnected) return false;
      popup.__dcuiAnchoredPopupCloseObserver?.disconnect();
      popup.__dcuiAnchoredPopupCloseObserver = null;
      this.clearAlignmentTracking(popup);
      if (origin.nextSibling?.parentNode === origin.parent) {
        origin.parent.insertBefore(popup, origin.nextSibling);
      } else {
        origin.parent.appendChild(popup);
      }
      popup.classList.remove(
        "dcui-anchored-popup",
        "dcui-manager-report-popup",
        "dcui-relation-popup",
      );
      if (origin.style === null) popup.removeAttribute("style");
      else popup.setAttribute("style", origin.style);
      popup.style.setProperty("display", "none");
      return true;
    },

    trackAlignment(popup, anchor, popupClass = "") {
      this.clearAlignmentTracking(popup);
      const resolveAnchor = () => (typeof anchor === "function" ? anchor() : anchor);
      const align = () => {
        if (!this.isShown(popup)) return;
        this.position(popup, resolveAnchor(), popupClass);
      };
      popup.__dcuiAnchoredPopupAlignmentTimers = [50, 150, 400, 1000, 2500]
        .map((delay) => window.setTimeout(align, delay));
      if (typeof ResizeObserver !== "function") return;
      const observer = new ResizeObserver(align);
      const popupHost = DcAdapter.leftContent();
      const popupAnchor = resolveAnchor();
      if (popupHost) observer.observe(popupHost);
      if (popupAnchor && popupAnchor !== popupHost) observer.observe(popupAnchor);
      popup.__dcuiAnchoredPopupResizeObserver = observer;
    },

    watchClose(popup) {
      popup.__dcuiAnchoredPopupCloseObserver?.disconnect();
      if (typeof MutationObserver !== "function") return;
      const observer = new MutationObserver(() => {
        if (this.isShown(popup)) return;
        observer.disconnect();
        this.restoreOrigin(popup);
      });
      observer.observe(popup, {
        attributes: true,
        attributeFilter: ["class", "style", "hidden"],
      });
      popup.__dcuiAnchoredPopupCloseObserver = observer;
    },

    position(popup, anchor, popupClass = "") {
      const openingClass = this.openingClass(popupClass);
      const openingHidden = Boolean(
        popup?.isConnected
        && openingClass
        && document.documentElement.classList.contains(openingClass)
        && getComputedStyle(popup).display !== "none",
      );
      if (!this.isShown(popup) && !openingHidden) return false;
      const popupHost = DcAdapter.leftContent() || document.body;
      const popupAnchor = anchor?.isConnected ? anchor : popupHost;
      if (getComputedStyle(popupHost).position === "static") {
        popupHost.style.setProperty("position", "relative", "important");
      }
      this.rememberOrigin(popup);
      popup.classList.add("dcui-anchored-popup");
      if (popupClass) popup.classList.add(popupClass);
      if (popup.parentElement !== popupHost) popupHost.appendChild(popup);

      const popupRect = popup.getBoundingClientRect();
      if (popupRect.width <= 0 || popupRect.height <= 0) return false;
      const hostRect = popupHost.getBoundingClientRect();
      const anchorRect = popupAnchor.getBoundingClientRect();
      const listRect = DcAdapter.listRoot()?.getBoundingClientRect();
      const top = Math.max(0, anchorRect.bottom - hostRect.top + popupHost.scrollTop + 5);
      const right = Math.max(0, hostRect.right - (listRect?.right || hostRect.right));
      popup.style.setProperty("--dcui-anchored-popup-top", `${Math.round(top)}px`);
      popup.style.setProperty("--dcui-anchored-popup-right", `${Math.round(right)}px`);
      popup.style.setProperty("position", "absolute", "important");
      popup.style.setProperty("top", "var(--dcui-anchored-popup-top)", "important");
      popup.style.setProperty("right", "var(--dcui-anchored-popup-right)", "important");
      popup.style.setProperty("bottom", "auto", "important");
      popup.style.setProperty("left", "auto", "important");
      popup.style.setProperty("margin", "0", "important");
      popup.style.setProperty("transform", "none", "important");
      popup.style.setProperty("z-index", "10020", "important");
      this.clearOpening(popupClass);
      this.watchClose(popup);
      return true;
    },

    watch(trigger, popupSelector, anchor, popupClass = "") {
      trigger.__dcuiAnchoredPopupObserver?.disconnect();
      if (trigger.__dcuiAnchoredPopupTimer) {
        window.clearTimeout(trigger.__dcuiAnchoredPopupTimer);
      }
      const resolveAnchor = () => (typeof anchor === "function" ? anchor() : anchor) || trigger;
      const finish = () => {
        const popup = document.querySelector(popupSelector);
        if (!this.position(popup, resolveAnchor(), popupClass)) return false;
        this.trackAlignment(popup, resolveAnchor, popupClass);
        return true;
      };
      if (finish() || typeof MutationObserver !== "function") return;

      const observer = new MutationObserver(() => {
        if (!finish()) return;
        observer.disconnect();
        if (trigger.__dcuiAnchoredPopupTimer) {
          window.clearTimeout(trigger.__dcuiAnchoredPopupTimer);
          trigger.__dcuiAnchoredPopupTimer = 0;
        }
        if (trigger.__dcuiAnchoredPopupObserver === observer) {
          trigger.__dcuiAnchoredPopupObserver = null;
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style"],
      });
      trigger.__dcuiAnchoredPopupObserver = observer;
      trigger.__dcuiAnchoredPopupTimer = window.setTimeout(() => {
        finish();
        observer.disconnect();
        if (trigger.__dcuiAnchoredPopupObserver === observer) {
          trigger.__dcuiAnchoredPopupObserver = null;
        }
        trigger.__dcuiAnchoredPopupTimer = 0;
      }, 10000);
    },

    pageFunctionReady(functionName) {
      if (!functionName) return true;
      try {
        if (typeof unsafeWindow !== "undefined") {
          return typeof unsafeWindow[functionName] === "function";
        }
      } catch {
        // A non-Tampermonkey injection test has no page-world bridge.
      }
      return true;
    },

    clearPendingClick(trigger) {
      if (trigger.__dcuiNativeReadyTimer) {
        window.clearTimeout(trigger.__dcuiNativeReadyTimer);
        trigger.__dcuiNativeReadyTimer = 0;
      }
      delete trigger.dataset.dcuiNativeClickPending;
      trigger.removeAttribute("aria-busy");
    },

    queueNativeClick(trigger, functionName) {
      if (trigger.dataset.dcuiNativeClickPending === "true") return;
      trigger.dataset.dcuiNativeClickPending = "true";
      trigger.setAttribute("aria-busy", "true");
      const startedAt = Date.now();
      const check = () => {
        if (!trigger.isConnected || Date.now() - startedAt >= 10000) {
          this.clearPendingClick(trigger);
          return;
        }
        if (!this.pageFunctionReady(functionName)) {
          trigger.__dcuiNativeReadyTimer = window.setTimeout(check, 25);
          return;
        }
        this.clearPendingClick(trigger);
        trigger.dataset.dcuiNativeClickReplay = "true";
        try {
          trigger.click();
        } finally {
          delete trigger.dataset.dcuiNativeClickReplay;
        }
      };
      check();
    },

    watchAfterNativeClick(trigger, popupSelector, anchor, popupClass) {
      if (trigger.__dcuiAnchoredPopupPostClickTimer) {
        window.clearTimeout(trigger.__dcuiAnchoredPopupPostClickTimer);
      }
      trigger.__dcuiAnchoredPopupPostClickTimer = window.setTimeout(() => {
        trigger.__dcuiAnchoredPopupPostClickTimer = 0;
        this.watch(trigger, popupSelector, anchor, popupClass);
      }, 0);
    },

    refreshInPlace({ popup, trigger, popupSelector, anchor, popupClass }) {
      if (!popup || !trigger) return;
      trigger.__dcuiAnchoredPopupRefreshObserver?.disconnect();
      if (trigger.__dcuiAnchoredPopupRefreshTimer) {
        window.clearTimeout(trigger.__dcuiAnchoredPopupRefreshTimer);
      }
      const resolveAnchor = () => (typeof anchor === "function" ? anchor() : anchor) || trigger;
      const merge = () => {
        const replacement = Array.from(document.querySelectorAll(popupSelector))
          .find((candidate) => candidate !== popup);
        if (!replacement) return false;
        popup.replaceChildren(...replacement.childNodes);
        popup.className = replacement.className;
        replacement.remove();
        popup.style.setProperty("display", "block", "important");
        const popupHost = DcAdapter.leftContent() || document.body;
        if (popup.parentElement !== popupHost) popupHost.appendChild(popup);
        if (!this.position(popup, resolveAnchor(), popupClass)) return false;
        this.trackAlignment(popup, resolveAnchor, popupClass);
        return true;
      };
      const finish = () => {
        if (!merge()) return false;
        trigger.__dcuiAnchoredPopupRefreshObserver?.disconnect();
        trigger.__dcuiAnchoredPopupRefreshObserver = null;
        if (trigger.__dcuiAnchoredPopupRefreshTimer) {
          window.clearTimeout(trigger.__dcuiAnchoredPopupRefreshTimer);
          trigger.__dcuiAnchoredPopupRefreshTimer = 0;
        }
        return true;
      };
      queueMicrotask(finish);
      if (typeof MutationObserver !== "function") return;
      const observer = new MutationObserver(finish);
      observer.observe(document.body, { childList: true, subtree: true });
      trigger.__dcuiAnchoredPopupRefreshObserver = observer;
      trigger.__dcuiAnchoredPopupRefreshTimer = window.setTimeout(() => {
        finish();
        observer.disconnect();
        if (trigger.__dcuiAnchoredPopupRefreshObserver === observer) {
          trigger.__dcuiAnchoredPopupRefreshObserver = null;
        }
        trigger.__dcuiAnchoredPopupRefreshTimer = 0;
      }, 10000);
    },

    closeFromTrigger(popup, closeSelector = "") {
      if (!this.isShown(popup)) return false;
      const closeButton = closeSelector ? popup.querySelector(closeSelector) : null;
      closeButton?.click();
      if (this.isShown(popup)) popup.style.setProperty("display", "none", "important");
      if (popup.isConnected) this.restoreOrigin(popup);
      return !this.isShown(popup);
    },

    bind({
      trigger,
      popupSelector,
      anchor,
      popupClass = "",
      nativeFunction = "",
      closeSelector = "",
    }) {
      if (!trigger || !popupSelector || trigger.dataset.dcuiAnchoredPopupBound === popupSelector) return;
      trigger.dataset.dcuiAnchoredPopupBound = popupSelector;
      trigger.addEventListener("click", (event) => {
        if (!document.documentElement.classList.contains("dcui-enabled")) return;
        const openPopup = document.querySelector(popupSelector);
        if (this.isVisiblyOpen(openPopup)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.closeFromTrigger(openPopup, closeSelector);
          return;
        }
        if (trigger.dataset.dcuiNativeClickReplay === "true") {
          this.watchAfterNativeClick(trigger, popupSelector, anchor, popupClass);
          return;
        }
        if (nativeFunction && !this.pageFunctionReady(nativeFunction)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.queueNativeClick(trigger, nativeFunction);
          return;
        }
        this.watchAfterNativeClick(trigger, popupSelector, anchor, popupClass);
      }, true);
    },
  });

  function bindEarlyAnchoredPopupClicks() {
    let pendingPointerActivation = null;
    const recoverableTriggerFromEvent = (event) => event.target.closest?.(
      ".btn_mngadmin_report, .gall_issuebox .relate, .dcui-submanager-toggle, button.smallestgag[onclick*='mini_member_join']",
    ) || null;

    document.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || GM_getValue(THEME_ENABLED_KEY, true) === false) return;
      const trigger = recoverableTriggerFromEvent(event);
      if (!trigger) return;
      pendingPointerActivation = {
        trigger,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        clickObserved: false,
      };
    }, true);

    document.addEventListener("pointermove", (event) => {
      const pending = pendingPointerActivation;
      if (!pending || pending.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8) {
        pending.moved = true;
      }
    }, true);

    document.addEventListener("pointerup", (event) => {
      const pending = pendingPointerActivation;
      if (!pending || pending.pointerId !== event.pointerId) return;
      window.setTimeout(() => {
        if (pendingPointerActivation === pending) pendingPointerActivation = null;
        if (pending.moved || pending.clickObserved || !pending.trigger.isConnected) return;
        pending.trigger.click();
      }, 0);
    }, true);

    document.addEventListener("pointercancel", (event) => {
      if (pendingPointerActivation?.pointerId === event.pointerId) {
        pendingPointerActivation = null;
      }
    }, true);

    document.addEventListener("click", (event) => {
      const activationTarget = recoverableTriggerFromEvent(event);
      if (activationTarget && pendingPointerActivation?.trigger === activationTarget) {
        pendingPointerActivation.clickObserved = true;
      }
      const memberJoinTrigger = event.target.closest?.("button.smallestgag[onclick*='mini_member_join']");
      if (memberJoinTrigger) {
        if (memberJoinTrigger.dataset.dcuiNativeClickReplay === "true") return;
        if (GM_getValue(THEME_ENABLED_KEY, true) === false) return;
        if (!AnchoredPopupController.pageFunctionReady("mini_member_join")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          AnchoredPopupController.queueNativeClick(memberJoinTrigger, "mini_member_join");
        }
        return;
      }
      const managerPopupAction = event.target.closest?.([
        "#pop_manage_report_list [onclick*='get_manage_report']",
        "#pop_manage_report_list a[href*='get_manage_report']",
      ].join(","));
      if (managerPopupAction) {
        const reportTrigger = document.querySelector(".dcui-manager-line .btn_mngadmin_report")
          || document.querySelector(".btn_mngadmin_report");
        const currentPopup = managerPopupAction.closest("#pop_manage_report_list");
        if (reportTrigger) {
          AnchoredPopupController.refreshInPlace({
            popup: currentPopup,
            trigger: reportTrigger,
            popupSelector: "#pop_manage_report_list",
            anchor: () => document.querySelector(".dcui-manager-line") || reportTrigger,
            popupClass: "dcui-manager-report-popup",
          });
        }
        return;
      }
      const trigger = event.target.closest?.(".btn_mngadmin_report, .gall_issuebox .relate");
      if (!trigger) return;
      if (trigger.matches(".gall_issuebox .relate")
        && !AnchoredPopupController.isVisiblyOpen(document.querySelector("#relation_popup"))) {
        AnchoredPopupController.armOpening("dcui-relation-popup");
      }
      if (trigger.dataset.dcuiAnchoredPopupBound) return;
      if (GM_getValue(THEME_ENABLED_KEY, true) === false) return;
      const isManager = trigger.matches(".btn_mngadmin_report");
      const config = isManager
        ? {
            popupSelector: "#pop_manage_report_list",
            popupClass: "dcui-manager-report-popup",
            nativeFunction: "get_manage_report",
            closeSelector: ".poply_whiteclose",
            anchor: () => document.querySelector(".dcui-manager-line")
              || trigger.closest(".info_cont, .minor_intro_box, .mini_intro_box, .person_intro_box")
              || trigger,
          }
        : {
            popupSelector: "#relation_popup",
            popupClass: "dcui-relation-popup",
            nativeFunction: "open_relation",
            closeSelector: ".poply_bgblueclose",
            anchor: () => trigger.closest(".page_head") || trigger,
          };
      const openPopup = document.querySelector(config.popupSelector);
      if (AnchoredPopupController.isVisiblyOpen(openPopup)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        AnchoredPopupController.closeFromTrigger(openPopup, config.closeSelector);
        return;
      }
      if (trigger.dataset.dcuiNativeClickReplay === "true") {
        AnchoredPopupController.watchAfterNativeClick(
          trigger,
          config.popupSelector,
          config.anchor,
          config.popupClass,
        );
        return;
      }
      if (!AnchoredPopupController.pageFunctionReady(config.nativeFunction)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        AnchoredPopupController.queueNativeClick(trigger, config.nativeFunction);
        return;
      }
      AnchoredPopupController.watchAfterNativeClick(
        trigger,
        config.popupSelector,
        config.anchor,
        config.popupClass,
      );
    }, true);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !event.target.closest?.("#pop_manage_report_list")) return;
      const reportTrigger = document.querySelector(".dcui-manager-line .btn_mngadmin_report")
        || document.querySelector(".btn_mngadmin_report");
      const currentPopup = event.target.closest("#pop_manage_report_list");
      if (!reportTrigger || !currentPopup) return;
      AnchoredPopupController.refreshInPlace({
        popup: currentPopup,
        trigger: reportTrigger,
        popupSelector: "#pop_manage_report_list",
        anchor: () => document.querySelector(".dcui-manager-line") || reportTrigger,
        popupClass: "dcui-manager-report-popup",
      });
    }, true);
  }

  bindEarlyAnchoredPopupClicks();

  const ThemeController = Object.freeze({
    isEnabled() {
      return GM_getValue(THEME_ENABLED_KEY, true) !== false;
    },

    init(context) {
      const root = document.documentElement;
      root.classList.add("dcui-ready", `dcui-page-${context.pageType}`, `dcui-gallery-${context.galleryType}`);
      root.classList.toggle("dcui-realtime-best", context.isRealtimeBest);
      root.dataset.dcuiVersion = SCRIPT_VERSION;
      this.injectBaseStyle();
      root.classList.toggle("dcui-enabled", this.isEnabled());
      this.mountScreenToggle();
    },

    setEnabled(enabled) {
      GM_setValue(THEME_ENABLED_KEY, Boolean(enabled));
      document.documentElement.classList.toggle("dcui-enabled", Boolean(enabled));
    },

    mountScreenToggle(target = null) {
      if (!this.isEnabled()) this.restoreNativeDarkMode();
      if (!target && this.isEnabled()) {
        target = document.querySelector("#dcui-shell [data-role='themeToggleMount']");
      }
      let button = document.getElementById("dcui-theme-toggle");
      if (!button) {
        button = document.createElement("button");
        button.id = "dcui-theme-toggle";
        button.type = "button";
        button.setAttribute("role", "switch");
        button.innerHTML = `
          <span class="dcui-theme-toggle-label">UI변경</span>
          <span class="dcui-theme-toggle-track" aria-hidden="true">
            <span class="dcui-theme-toggle-thumb"></span>
          </span>
        `;
        button.addEventListener("click", () => {
          if (button.dataset.dcuiThemeTransitioning === "true") return;
          button.dataset.dcuiThemeTransitioning = "true";
          const thumb = button.querySelector(".dcui-theme-toggle-thumb");
          if (thumb) getComputedStyle(thumb).transform;
          GM_setValue(THEME_ENABLED_KEY, !this.isEnabled());
          this.syncScreenToggle(button);
          window.setTimeout(() => location.reload(), 220);
        });
      }
      this.syncScreenToggle(button);
      this.placeScreenToggle(button, target);
      return button;
    },

    restoreNativeDarkMode() {
      const nativeDarkMode = document.querySelector("#dcui-shell .dcui-native-dark-mode");
      const anchor = document.getElementById("dcui-native-dark-mode-anchor");
      if (!nativeDarkMode || !anchor) return;
      nativeDarkMode.classList.remove("dcui-native-dark-mode");
      anchor.replaceWith(nativeDarkMode);
    },

    syncScreenToggle(button) {
      const enabled = this.isEnabled();
      button.setAttribute("aria-checked", String(enabled));
      button.setAttribute("aria-label", `UI 변경 ${enabled ? "끄기" : "켜기"}`);
      button.title = enabled ? "디시인사이드 원본 UI로 전환" : "새 UI로 전환";
    },

    placeScreenToggle(button, target = null) {
      if (target) {
        document.getElementById("dcui-native-theme-toggle-mount")?.remove();
        document.getElementById("dcui-native-theme-toggle-list")?.remove();
        target.appendChild(button);
        return;
      }

      const nativeDarkMode = document.querySelector("#top > .dcheader .area_links > .darkmodebox, .dcheader .area_links > .darkmodebox");
      if (nativeDarkMode) {
        document.getElementById("dcui-native-theme-toggle-mount")?.remove();
        let list = document.getElementById("dcui-native-theme-toggle-list");
        if (!list) {
          list = document.createElement("ul");
          list.id = "dcui-native-theme-toggle-list";
          list.className = "fl dcui-theme-toggle-list";
          const item = document.createElement("li");
          item.id = "dcui-native-theme-toggle-item";
          list.appendChild(item);
          nativeDarkMode.insertAdjacentElement("afterend", list);
        }
        list.querySelector("#dcui-native-theme-toggle-item")?.appendChild(button);
        return;
      }
      document.body.appendChild(button);
    },

    injectBaseStyle() {
      if (document.getElementById("dcui-base-style")) return;

      const style = document.createElement("style");
      style.id = "dcui-base-style";
      style.textContent = `
        html.dcui-ready {
          --dcui-page-width: 1050px;
          --dcui-content-width: 840px;
          --dcui-sidebar-width: 190px;
          --dcui-column-gap: 20px;
          --dcui-color-text: #333;
          --dcui-color-text-strong: #222;
          --dcui-color-text-soft: #555;
          --dcui-color-muted: #777;
          --dcui-color-faint: #999;
          --dcui-color-featured-title: #666;
          --dcui-color-featured-visited: #a6a6a6;
          --dcui-color-on-accent: #fff;
          --dcui-color-link: #3b4890;
          --dcui-color-link-secondary: #3262c5;
          --dcui-color-link-bright: #377ee9;
          --dcui-color-link-muted: #369;
          --dcui-color-accent: #3b4890;
          --dcui-color-nav: #29367c;
          --dcui-color-nav-light: #3b4890;
          --dcui-color-surface: #fff;
          --dcui-color-subtle: #f9f9f9;
          --dcui-color-surface-muted: #f5f5f5;
          --dcui-color-surface-strong: #eee;
          --dcui-color-surface-hover: #f3f7ff;
          --dcui-color-surface-selected: #eef0f8;
          --dcui-color-surface-notice: #fafafa;
          --dcui-color-surface-survey: #f7f9fd;
          --dcui-color-surface-ad: #fffdf7;
          --dcui-color-border: #ddd;
          --dcui-color-border-soft: #e7e7e7;
          --dcui-color-border-strong: #ccc;
          --dcui-color-border-control: #aaa;
          --dcui-color-border-accent: #29367c;
          --dcui-color-icon: #596273;
          --dcui-color-control-hover: #d4d4d4;
          --dcui-color-control-active: #e4e4e4;
          --dcui-color-toggle-track: #bbb;
          --dcui-color-control-gradient-top: #fff;
          --dcui-color-control-gradient-bottom: #f3f3f3;
          --dcui-color-control-gradient-soft-bottom: #f9f9f9;
          --dcui-color-control-highlight: #fff;
          --dcui-control-border: #b9c1dc;
          --dcui-control-border-hover: #8996c8;
          --dcui-control-border-focus: #3b4890;
          --dcui-control-addon-border: #d7dbea;
          --dcui-control-addon-surface: #f4f5fa;
          --dcui-control-radius: 3px;
          --dcui-control-shadow: 0 1px 1px rgb(40 50 100 / 5%);
          --dcui-font: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", Arial, Dotum, 돋움, sans-serif;
        }
        html.dcui-enabled {
          color: var(--dcui-color-text);
          background: var(--dcui-color-surface);
        }
        html.dcui-ready:has(#css-darkmode) {
          color-scheme: dark;
          --dcui-color-text: #ccc;
          --dcui-color-text-strong: #ddd;
          --dcui-color-text-soft: #bbb;
          --dcui-color-muted: #999;
          --dcui-color-faint: #888;
          --dcui-color-featured-title: #999;
          --dcui-color-featured-visited: #555;
          --dcui-color-on-accent: #fff;
          --dcui-color-link: #afafaf;
          --dcui-color-link-secondary: #98c7e4;
          --dcui-color-link-bright: #377ee9;
          --dcui-color-link-muted: #999;
          --dcui-color-accent: #7d8fe5;
          --dcui-color-nav: #8294ee;
          --dcui-color-nav-light: #4e5fae;
          --dcui-color-surface: #121212;
          --dcui-color-subtle: #191919;
          --dcui-color-surface-muted: #222;
          --dcui-color-surface-strong: #333;
          --dcui-color-surface-hover: #232323;
          --dcui-color-surface-selected: #232323;
          --dcui-color-surface-notice: #232323;
          --dcui-color-surface-survey: #222;
          --dcui-color-surface-ad: #222;
          --dcui-color-border: #444;
          --dcui-color-border-soft: #222;
          --dcui-color-border-strong: #555;
          --dcui-color-border-control: #666;
          --dcui-color-border-accent: #4e5fae;
          --dcui-color-icon: #aaa;
          --dcui-color-control-hover: #333;
          --dcui-color-control-active: #333;
          --dcui-color-toggle-track: #555;
          --dcui-color-control-gradient-top: #222;
          --dcui-color-control-gradient-bottom: #191919;
          --dcui-color-control-gradient-soft-bottom: #111;
          --dcui-color-control-highlight: #191919;
          --dcui-control-border: #444;
          --dcui-control-border-hover: #666;
          --dcui-control-border-focus: #aaa;
          --dcui-control-addon-border: #444;
          --dcui-control-addon-surface: #222;
          --dcui-control-shadow: 0 1px 1px rgb(0 0 0 / 28%);
        }
        /* FM Korea /lol night_mode, measured 2026-09-19. Keep DC branding
           and native dark-mode activation; apply the neutral surface palette. */
        html.dcui-enabled:has(#css-darkmode) #dcui-shell .dcui-nav-bar nav {
          background: #333;
          border-color: #444;
        }
        html.dcui-enabled:has(#css-darkmode) #dcui-shell .dcui-nav-bar a {
          color: #ddd;
          text-shadow: none;
        }
        html.dcui-enabled:has(#css-darkmode) #dcui-shell .dcui-nav-bar a:is(:hover, :focus-visible, .dcui-active) {
          color: #cece34;
          background: #363636;
        }
        html.dcui-enabled:has(#css-darkmode) #dcui-gallery-strip .dcui-gallery-strip-inner {
          background: #2b2b2b;
        }
        html.dcui-enabled:has(#css-darkmode) #dcui-shell #search_wrap .top_search,
        html.dcui-enabled:has(#css-darkmode) #dcui-shell #search_wrap .inner_search,
        html.dcui-enabled:has(#css-darkmode) #dcui-shell #search_wrap .in_keyword {
          background: var(--dcui-color-surface) !important;
        }
        html.dcui-enabled:has(#css-darkmode) .dcui-fm-bottom-menu .bottom_search,
        html.dcui-enabled:has(#css-darkmode) .dcui-fm-bottom-menu .bottom_search .inner_search,
        html.dcui-enabled:has(#css-darkmode) .dcui-fm-bottom-menu .bottom_search .in_keyword {
          background: var(--dcui-color-surface-muted) !important;
        }
        html.dcui-enabled:has(#css-darkmode) table.dcui-list-table thead th {
          background: #121212;
          border-color: #3c3c3c;
          box-shadow: inset 0 -1px 0 #191919;
        }
        html.dcui-enabled:has(#css-darkmode) table.dcui-list-table .gall_tit > a:not(.reply_numbox) {
          color: #afafaf;
        }
        html.dcui-enabled:has(#css-darkmode) table.dcui-list-table .gall_tit > a:not(.reply_numbox):visited {
          color: #666;
        }
        html.dcui-enabled:has(#css-darkmode) .dcui-article-body :is(.writing_view_box, .write_div),
        html.dcui-enabled:has(#css-darkmode) .dcui-comments .usertxt {
          color: #bbb;
        }
        html.dcui-enabled:has(#css-darkmode) .dcui-article-body :is(.writing_view_box, .write_div) a {
          color: #98c7e4;
        }
        html.dcui-enabled:has(#css-darkmode) #dcui-shell :is(#alarmList, #alarmConf),
        html.dcui-enabled:has(#css-darkmode) #dcui-shell :is(#alarmList, #alarmConf) > .pop_content {
          background: var(--dcui-color-surface);
          border-color: var(--dcui-color-border);
          color: var(--dcui-color-text);
        }
        html.dcui-enabled:has(#css-darkmode) #dcui-shell :is(#alarmList, #alarmConf) .pop_head {
          background: var(--dcui-color-surface-muted);
          border-color: var(--dcui-color-border);
        }
        html.dcui-enabled:has(#css-darkmode) #dcui-shell :is(#alarmList, #alarmConf) :is(h3, .notice_txt, .btn_noti_alldel, .btn_noti_setting) {
          color: var(--dcui-color-text-soft);
        }
        html.dcui-enabled:has(#css-darkmode) :is(#dcui-sidebar .setting_list, #dcui-settings-modal) input[type="checkbox"] {
          accent-color: #888;
        }
        html.dcui-enabled:has(#css-darkmode) :is(#dcui-sidebar .setting_list, #dcui-settings-modal) .checkbox .checkmark {
          background: #121212 !important;
          border-color: #666 !important;
        }
        html.dcui-enabled:has(#css-darkmode) :is(#dcui-sidebar .setting_list, #dcui-settings-modal) .checkbox input[type="checkbox"]:checked + .checkmark {
          background: #333 !important;
          border-color: #888 !important;
        }
        html.dcui-enabled:has(#css-darkmode) :is(#dcui-sidebar .setting_list, #dcui-settings-modal) .checkbox input[type="checkbox"]:checked + .checkmark::after {
          position: absolute;
          display: block;
          top: 50%;
          left: 50%;
          width: 3px;
          height: 6px;
          background: none !important;
          border: solid #ccc !important;
          border-width: 0 2px 2px 0 !important;
          box-shadow: none;
          transform: translate(-50%, -65%) rotate(45deg);
          content: "";
        }
        html.dcui-enabled:has(#css-darkmode) :is(#dcui-sidebar .setting_list, #dcui-settings-modal) .checkbox input[type="checkbox"]:not(:checked) + .checkmark::after {
          display: none;
        }
        html.dcui-enabled:has(#css-darkmode) :is(#dcui-sidebar .setting_list, #dcui-settings-modal) .checkbox input[type="checkbox"]:focus-visible + .checkmark {
          outline: 2px solid #aaa;
          outline-offset: 2px;
        }
        html.dcui-enabled body,
        html.dcui-enabled button,
        html.dcui-enabled input,
        html.dcui-enabled select,
        html.dcui-enabled textarea {
          font-family: var(--dcui-font);
        }
        html.dcui-enabled body {
          min-width: var(--dcui-page-width);
          background: var(--dcui-color-surface);
          color: var(--dcui-color-text);
        }
        html.dcui-enabled .ad_left_wing_list_top,
        html.dcui-enabled .ad_left_wing_right_top,
        html.dcui-enabled .ad_left_wing_list_top + div[style*="position:absolute"][style*="margin-left"],
        html.dcui-enabled #ad-layer,
        html.dcui-enabled #ad-pop-layer,
        html.dcui-enabled #ad-layer-closer,
        html.dcui-enabled #ad-pop-layer-closer,
        html.dcui-enabled .banner_box:has(> script[src*="addc.dcinside.com/NetInsight/"]),
        html.dcui-enabled .banner_box:has(> a[href*="addc.dcinside.com"][href*="/click/dcinside/pc/list@top_"]),
        html.dcui-enabled .con_banner.writing_banbox,
        html.dcui-enabled .stickyunit,
        html.dcui-enabled #gfp_sf_align > #ad-element,
        html.dcui-enabled #gfp_sf_align > .native_image_wrap,
        html.dcui-enabled .cm_ad[data-ad-node] > .link_ad,
        html.dcui-enabled .cm_ad[data-ad-node] > .icon_ad,
        html.dcui-enabled .view_ad_wrap > .power_link,
        html.dcui-enabled .dcui-comments .cmt_list > li.power_link.cmt_power_link,
        html.dcui-enabled .kakao_ad_area,
        html.dcui-enabled .google-auto-placed,
        html.dcui-enabled [id^="google_ads_"],
        html.dcui-enabled [id^="div-gpt-ad"],
        html.dcui-enabled [id^="criteo-"],
        html.dcui-enabled ins.adsbygoogle,
        html.dcui-enabled iframe[id^="ad_frame"],
        html.dcui-enabled iframe[src*="ad.xc.netinsight.co.kr"],
        html.dcui-enabled iframe[src*="ad.adnmore.co.kr"],
        html.dcui-enabled iframe[src*="doubleclick.net"],
        html.dcui-enabled iframe[src*="googlesyndication.com"] {
          display: none !important;
        }
        html.dcui-enabled table.gall_list tr.dcui-row-ad,
        html.dcui-enabled table.gall_list tr[data-type="icon_ad"] {
          display: none !important;
        }
        html.dcui-enabled footer.dcfoot .dc_all {
          display: none !important;
        }
        html.dcui-enabled .wrap_inner,
        html.dcui-enabled #container {
          width: var(--dcui-page-width);
        }
        html.dcui-enabled .page_head {
          border-bottom-color: var(--dcui-color-border);
        }
        html.dcui-enabled .page_head h2 a {
          color: var(--dcui-color-link);
        }
        html.dcui-enabled :focus-visible {
          outline: 2px solid var(--dcui-color-accent);
          outline-offset: 2px;
        }
        html.dcui-enabled .dcui-control-frame {
          box-sizing: border-box;
          border: 1px solid var(--dcui-control-border) !important;
          border-radius: var(--dcui-control-radius) !important;
          background: var(--dcui-color-surface) !important;
          box-shadow: var(--dcui-control-shadow) !important;
          transition: border-color 100ms ease, box-shadow 100ms ease;
        }
        html.dcui-enabled .dcui-control-frame:hover {
          border-color: var(--dcui-control-border-hover) !important;
        }
        html.dcui-enabled .dcui-control-frame:focus-visible,
        html.dcui-enabled .dcui-control-frame:focus-within {
          border-color: var(--dcui-control-border-focus) !important;
          box-shadow: 0 0 0 1px var(--dcui-control-border-focus) !important;
          outline: 0;
        }
        html.dcui-enabled .dcui-control-frame .dcui-control-addon {
          border-left: 1px solid var(--dcui-control-addon-border) !important;
          background: var(--dcui-control-addon-surface) !important;
        }
        #dcui-theme-toggle {
          position: static;
          box-sizing: border-box;
          display: inline-flex;
          height: 22px;
          align-items: center;
          gap: 5px;
          padding: 0;
          border: 0;
          background: transparent;
          box-shadow: none;
          color: var(--dcui-color-text-soft);
          font: 400 11px/22px var(--dcui-font);
          white-space: nowrap;
          cursor: pointer;
        }
        #dcui-theme-toggle .dcui-theme-toggle-label {
          line-height: 22px;
        }
        #dcui-theme-toggle .dcui-theme-toggle-track {
          position: relative;
          box-sizing: border-box;
          display: inline-block;
          width: 32px;
          height: 16px;
          flex: 0 0 32px;
          border: 1px solid var(--dcui-color-border-control);
          border-radius: 999px;
          background: var(--dcui-color-toggle-track);
          transition: border-color 160ms ease, background-color 160ms ease;
        }
        #dcui-theme-toggle .dcui-theme-toggle-thumb {
          position: absolute;
          top: 1px;
          left: 1px;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--dcui-color-surface);
          box-shadow: 0 1px 2px rgb(0 0 0 / 28%);
          transition: transform 160ms ease;
        }
        #dcui-theme-toggle[aria-checked="true"] .dcui-theme-toggle-track {
          border-color: var(--dcui-color-nav-light);
          background: var(--dcui-color-nav-light);
        }
        #dcui-theme-toggle[aria-checked="true"] .dcui-theme-toggle-thumb {
          transform: translateX(16px);
        }
        #dcui-theme-toggle:hover .dcui-theme-toggle-label,
        #dcui-theme-toggle:focus-visible .dcui-theme-toggle-label {
          color: var(--dcui-color-link);
        }
        #dcui-theme-toggle:focus-visible {
          border-radius: 3px;
          outline: 2px solid var(--dcui-color-accent);
          outline-offset: 2px;
        }
        #dcui-native-theme-toggle-list {
          margin: 0;
          overflow: visible;
        }
        .area_links #dcui-native-theme-toggle-list > li:first-child::before,
        .area_links #dcui-native-theme-toggle-list > li:last-child::before {
          display: inline;
          content: "|";
          color: var(--dcui-color-border-strong);
          font-size: 10px;
          line-height: 10px;
          padding: 0 5px 0 4px;
          vertical-align: 1px;
        }
        .dcheader .area_links #dcui-theme-toggle {
          position: relative;
          top: -1px;
          height: 18px;
          gap: 5px;
          font-size: 11px;
          line-height: 18px;
          vertical-align: top;
        }
        .dcheader .area_links #dcui-theme-toggle .dcui-theme-toggle-label {
          line-height: 18px;
        }
        body > #dcui-theme-toggle {
          position: fixed;
          z-index: 2147483646;
          top: 8px;
          right: 8px;
          padding: 2px 6px;
          border: 1px solid var(--dcui-color-border);
          border-radius: 3px;
          background: var(--dcui-color-surface);
          box-shadow: 0 2px 6px rgb(0 0 0 / 18%);
        }
      `;
      document.documentElement.appendChild(style);
    },
  });

  const CustomSettingsController = {
    writerObserver: null,

    init() {
      this.setFeaturedHidden(this.isFeaturedHidden(), false);
      this.setGalleryCoverHidden(GM_getValue(GALLERY_COVER_HIDDEN_KEY, false) === true, false);
      this.setUserIdentifierVisible(GM_getValue(USER_IDENTIFIER_VISIBLE_KEY, false) === true, false);
    },

    mount(settingList) {
      const list = settingList?.querySelector(".inner > ul, ul");
      if (!list || list.querySelector(".dcui-custom-setting")) return;

      const controls = [
        {
          id: "dcui-hide-featured",
          label: "실베·최신 개념글 숨김",
          checked: this.isFeaturedHidden(),
          change: (checked) => this.setFeaturedHidden(checked),
        },
        {
          id: "dcui-hide-gallery-cover",
          label: "대문 이미지 숨김",
          checked: GM_getValue(GALLERY_COVER_HIDDEN_KEY, false) === true,
          change: (checked) => this.setGalleryCoverHidden(checked),
        },
        {
          id: "dcui-show-user-identifier",
          label: "이용자 식별 코드 표시",
          checked: GM_getValue(USER_IDENTIFIER_VISIBLE_KEY, false) === true,
          change: (checked) => this.setUserIdentifierVisible(checked),
        },
        {
          id: "dcui-enable-concept-alarm",
          label: "개념글 알림",
          checked: ConceptAlarmController.isEnabled(),
          change: (checked) => ConceptAlarmController.setEnabled(checked),
        },
      ];

      const fragment = document.createDocumentFragment();
      for (const control of controls) {
        const item = document.createElement("li");
        item.className = "dcui-custom-setting";
        item.innerHTML = `
          <span class="checkbox">
            <label for="${control.id}">${control.label}</label>
            <input type="checkbox" id="${control.id}">
            <em class="checkmark" aria-hidden="true"></em>
          </span>
        `;
        const input = item.querySelector("input");
        input.checked = control.checked;
        input.addEventListener("change", () => control.change(input.checked));
        fragment.appendChild(item);
      }
      list.prepend(fragment);
      this.setFeaturedHidden(this.isFeaturedHidden(), false);
    },

    isFeaturedHidden() {
      return GM_getValue("dcui:featured-hidden",
        GM_getValue("dcui:featured-realtime-collapsed", false) === true
          && GM_getValue("dcui:featured-concept-collapsed", false) === true) === true;
    },

    setFeaturedHidden(hidden, persist = true) {
      const value = Boolean(hidden);
      if (persist) GM_setValue("dcui:featured-hidden", value);
      document.documentElement.classList.toggle("dcui-featured-hidden", value);
      const input = document.getElementById("dcui-hide-featured");
      if (input) input.checked = value;
    },

    setGalleryCoverHidden(hidden, persist = true) {
      const value = Boolean(hidden);
      if (persist) GM_setValue(GALLERY_COVER_HIDDEN_KEY, value);
      document.documentElement.classList.toggle("dcui-gallery-cover-hidden", value);
      const input = document.getElementById("dcui-hide-gallery-cover");
      if (input) input.checked = value;
    },

    setUserIdentifierVisible(visible, persist = true) {
      const value = Boolean(visible);
      if (persist) GM_setValue(USER_IDENTIFIER_VISIBLE_KEY, value);
      document.documentElement.classList.toggle("dcui-user-identifier-visible", value);
      const input = document.getElementById("dcui-show-user-identifier");
      if (input) input.checked = value;
      if (value) {
        this.decorateWriters(document);
        this.watchWriters();
      } else {
        this.writerObserver?.disconnect();
        this.writerObserver = null;
        document.querySelectorAll(".dcui-user-identifier").forEach((node) => node.remove());
      }
    },

    decorateWriters(root) {
      const writers = [];
      if (root instanceof Element && root.matches(".ub-writer")) writers.push(root);
      root.querySelectorAll?.(".ub-writer").forEach((writer) => writers.push(writer));
      for (const writer of writers) this.decorateWriter(writer);
    },

    decorateWriter(writer) {
      const existing = writer.querySelector(":scope .dcui-user-identifier");
      const uid = cleanText(writer.dataset.uid);
      if (!uid || writer.hasAttribute("user_name")) {
        existing?.remove();
        return;
      }
      if (existing) {
        const label = `(${uid})`;
        const title = `식별 코드: ${uid}`;
        if (existing.textContent !== label) existing.textContent = label;
        if (existing.title !== title) existing.title = title;
        existing.setAttribute("role", "button");
        existing.setAttribute("aria-label", `식별 코드 ${uid} 글쓴이 메뉴 열기`);
        existing.tabIndex = 0;
        return;
      }

      const identifier = document.createElement("span");
      identifier.className = "dcui-user-identifier";
      identifier.textContent = `(${uid})`;
      identifier.title = `식별 코드: ${uid}`;
      identifier.setAttribute("role", "button");
      identifier.setAttribute("aria-label", `식별 코드 ${uid} 글쓴이 메뉴 열기`);
      identifier.tabIndex = 0;
      const container = writer.querySelector(".addbox")
        || writer.querySelector(".fl > span")
        || writer;
      container.appendChild(identifier);
    },

    watchWriters() {
      if (this.writerObserver || typeof MutationObserver !== "function" || !document.body) return;
      this.writerObserver = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "attributes") {
            this.decorateWriter(record.target);
            continue;
          }
          const parentWriter = record.target.closest?.(".ub-writer");
          if (parentWriter) this.decorateWriter(parentWriter);
          record.addedNodes.forEach((node) => {
            if (node instanceof Element) this.decorateWriters(node);
          });
        }
      });
      this.writerObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-uid"],
      });
    },
  };

  const GalleryStripView = Object.freeze({
    mount(siteRoot, shell, beforeNode) {
      if (document.getElementById("dcui-gallery-strip")) return;

      const strip = document.createElement("section");
      strip.id = "dcui-gallery-strip";
      strip.setAttribute("aria-label", "내 갤러리 바로가기");
      strip.innerHTML = `
        <div class="dcui-gallery-strip-inner">
          <div class="dcui-gallery-strip-viewport" data-role="galleryStripViewport">
            <div class="dcui-gallery-strip-track">
              <div class="dcui-gallery-strip-group dcui-favorites" data-role="favoriteGalleries"></div>
              <div class="dcui-gallery-strip-group dcui-recents" data-role="recentGalleries"></div>
            </div>
          </div>
          <button type="button" class="dcui-gallery-strip-expand" data-role="galleryStripExpand" aria-expanded="false" aria-label="최근 방문 갤러리 펼치기">
            <span class="dcui-gallery-strip-expand-icon" aria-hidden="true"></span>
          </button>
        </div>
        <div class="dcui-gallery-strip-expanded" data-role="galleryStripExpanded" hidden>
          <div class="dcui-gallery-strip-expanded-list" data-role="galleryStripExpandedList"></div>
          <div class="dcui-gallery-strip-footer">
            <span class="dcui-gallery-strip-footer-label">최근방문:</span>
            <button type="button" data-role="galleryStripClear">전체 삭제</button>
            <button type="button" data-role="galleryStripDeleteMode" aria-pressed="false">개별 삭제</button>
          </div>
        </div>
      `;
      siteRoot.insertBefore(strip, beforeNode);
      this.injectStyle();

      const refresh = () => this.refresh(strip);
      this.bindControls(strip);
      this.bindExpandedControls(strip);
      refresh();
      window.setTimeout(refresh, 300);
      window.setTimeout(refresh, 1200);
      window.setTimeout(refresh, 3000);

      const visitHistory = document.getElementById("visit_history");
      if (visitHistory && typeof MutationObserver === "function") {
        let frame = 0;
        const observer = new MutationObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(refresh);
        });
        observer.observe(visitHistory, { childList: true, subtree: true });
      }
    },

    refresh(strip) {
      const favoriteLinks = this.collectLinks([
        "#visit_history .bkmark_listbox a",
        "#visit_history .under_listbox.bkmark a",
      ]);
      const recentLinks = this.collectLinks([
        "#visit_history .vst_listbox a",
        "#visit_history .under_listbox.vst_list a",
      ]);
      const favoriteKeys = new Set(favoriteLinks.map((item) => this.galleryKey(item.href)).filter(Boolean));
      const uniqueRecentLinks = recentLinks.filter((item) => !favoriteKeys.has(this.galleryKey(item.href)));
      strip.__dcuiGalleryData = { favoriteLinks, recentLinks: uniqueRecentLinks };
      document.dispatchEvent(new CustomEvent("dcui:favorites-updated", {
        detail: { favoriteLinks },
      }));
      const track = strip.querySelector(".dcui-gallery-strip-track");
      let favoriteGroup = strip.querySelector('[data-role="favoriteGalleries"]');
      if (favoriteLinks.length === 0) {
        favoriteGroup?.remove();
      } else {
        if (!favoriteGroup && track) {
          favoriteGroup = document.createElement("div");
          favoriteGroup.className = "dcui-gallery-strip-group dcui-favorites";
          favoriteGroup.dataset.role = "favoriteGalleries";
          track.prepend(favoriteGroup);
        }
        this.renderLinks(favoriteGroup, favoriteLinks, "", false);
      }
      this.renderLinks(strip.querySelector('[data-role="recentGalleries"]'), uniqueRecentLinks, "", true);
      this.updateControls(strip);
      requestAnimationFrame(() => this.renderExpandedRemainder(strip));
    },

    galleryKey(href) {
      try {
        const url = new URL(href, location.origin);
        const id = url.searchParams.get("id");
        if (!id) return `${url.origin}${url.pathname.replace(/\/$/, "")}`.toLocaleLowerCase();
        const type = url.pathname.startsWith("/mini/")
          ? "mini"
          : url.pathname.startsWith("/mgallery/")
            ? "minor"
            : url.pathname.startsWith("/person/")
              ? "person"
              : "major";
        return `${type}:${id}`.toLocaleLowerCase();
      } catch (_error) {
        return "";
      }
    },

    collectLinks(selectors) {
      const links = [];
      const seen = new Set();
      for (const selector of selectors) {
        for (const source of document.querySelectorAll(selector)) {
          const name = cleanText(source.textContent);
          const href = this.galleryHref(source);
          const key = name.toLocaleLowerCase();
          if (!name || !href || seen.has(key)) continue;
          seen.add(key);
          const item = source.closest("li");
          const deleteButton = item?.querySelector(".btn_visit_del[data-id]");
          links.push({
            name,
            href,
            deleteId: deleteButton?.dataset.id || source.getAttribute("section") || "",
            deleteType: deleteButton?.dataset.gtype || "",
          });
        }
      }
      return links.slice(0, 64);
    },

    galleryHref(source) {
      const rawHref = source.getAttribute("href") || "";
      let url = null;
      try {
        url = new URL(rawHref, location.origin);
      } catch (_error) {
        url = null;
      }

      if (url?.protocol === "http:" || url?.protocol === "https:") {
        const shortcut = url.pathname.match(/^\/(?:(mini|mgallery|person)\/)?([^/]+)\/?$/);
        if (shortcut) {
          const prefix = shortcut[1] ? `/${shortcut[1]}` : "";
          url.pathname = `${prefix}/board/lists/`;
          url.search = `?id=${encodeURIComponent(shortcut[2])}`;
        }
        return galleryBoardHref(url.href);
      }

      const item = source.closest("li");
      const id = source.getAttribute("section")
        || source.getAttribute("data-id")
        || item?.querySelector("[data-id]")?.getAttribute("data-id");
      if (!id) return "";
      const type = item?.querySelector("[data-gtype]")?.getAttribute("data-gtype")
        || (item?.classList.contains("mi") ? "MI" : item?.classList.contains("m") ? "M" : "G");
      const prefix = type === "MI" ? "/mini" : type === "M" ? "/mgallery" : "";
      return galleryBoardHref(`${location.origin}${prefix}/board/lists/?id=${encodeURIComponent(id)}`);
    },

    renderLinks(container, links, emptyLabel, removable) {
      if (!container) return;
      container.replaceChildren();
      if (links.length === 0) {
        if (!emptyLabel) return;
        const empty = document.createElement("span");
        empty.className = "dcui-gallery-strip-empty";
        empty.textContent = emptyLabel;
        container.appendChild(empty);
        return;
      }
      for (const item of links) {
        const link = document.createElement("a");
        link.href = item.href;
        link.textContent = item.name;
        if (!removable) {
          container.appendChild(link);
          continue;
        }
        const wrapper = document.createElement("span");
        wrapper.className = "dcui-gallery-strip-item";
        wrapper.appendChild(link);
        if (item.deleteId) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "dcui-gallery-strip-delete";
          remove.dataset.id = item.deleteId;
          remove.dataset.gtype = item.deleteType;
          remove.setAttribute("aria-label", `${item.name} 최근 방문 삭제`);
          remove.textContent = "×";
          wrapper.appendChild(remove);
        }
        container.appendChild(wrapper);
      }
    },

    renderExpanded(strip, favoriteLinks, recentLinks) {
      const list = strip.querySelector('[data-role="galleryStripExpandedList"]');
      if (!list) return;
      list.replaceChildren();

      const appendItem = (item, favorite) => {
        const wrapper = document.createElement("div");
        wrapper.className = `dcui-gallery-strip-expanded-item ${favorite ? "dcui-favorite" : "dcui-recent"}`;
        const link = document.createElement("a");
        link.href = item.href;
        link.textContent = item.name;
        wrapper.appendChild(link);
        if (!favorite && item.deleteId) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "dcui-gallery-strip-delete";
          remove.dataset.id = item.deleteId;
          remove.dataset.gtype = item.deleteType;
          remove.setAttribute("aria-label", `${item.name} 최근 방문 삭제`);
          remove.textContent = "×";
          wrapper.appendChild(remove);
        }
        list.appendChild(wrapper);
      };

      favoriteLinks.forEach((item) => appendItem(item, true));
      recentLinks.forEach((item) => appendItem(item, false));
      list.parentElement?.classList.toggle("dcui-no-expanded-items", list.childElementCount === 0);
    },

    renderExpandedRemainder(strip) {
      const data = strip.__dcuiGalleryData || { favoriteLinks: [], recentLinks: [] };
      const viewport = strip.querySelector('[data-role="galleryStripViewport"]');
      const viewportRect = viewport?.getBoundingClientRect();
      const visibleKeys = new Set();
      if (viewportRect) {
        for (const link of viewport.querySelectorAll(".dcui-gallery-strip-group a")) {
          const rect = link.getBoundingClientRect();
          if (rect.right <= viewportRect.left || rect.left >= viewportRect.right) continue;
          const key = this.galleryKey(link.href);
          if (key) visibleKeys.add(key);
        }
      }
      const hiddenFavorites = data.favoriteLinks.filter((item) => !visibleKeys.has(this.galleryKey(item.href)));
      const hiddenRecents = data.recentLinks.filter((item) => !visibleKeys.has(this.galleryKey(item.href)));
      this.renderExpanded(strip, hiddenFavorites, hiddenRecents);
    },

    bindExpandedControls(strip) {
      const expanded = strip.querySelector('[data-role="galleryStripExpanded"]');
      const expandButton = strip.querySelector('[data-role="galleryStripExpand"]');
      const deleteModeButton = strip.querySelector('[data-role="galleryStripDeleteMode"]');
      const clearButton = strip.querySelector('[data-role="galleryStripClear"]');
      if (!expanded || !expandButton) return;

      const setExpanded = (open) => {
        strip.classList.toggle("dcui-expanded", open);
        expanded.hidden = !open;
        expandButton.setAttribute("aria-expanded", String(open));
        expandButton.setAttribute("aria-label", `최근 방문 갤러리 ${open ? "닫기" : "펼치기"}`);
        if (open) this.renderExpandedRemainder(strip);
      };
      expandButton.addEventListener("click", () => setExpanded(!strip.classList.contains("dcui-expanded")));
      deleteModeButton?.addEventListener("click", () => {
        const active = !strip.classList.contains("dcui-delete-mode");
        strip.classList.toggle("dcui-delete-mode", active);
        expanded.classList.toggle("dcui-delete-mode", active);
        deleteModeButton.setAttribute("aria-pressed", String(active));
      });
      strip.addEventListener("click", (event) => {
        const remove = event.target.closest(".dcui-gallery-strip-delete");
        if (!remove) return;
        const original = Array.from(document.querySelectorAll("#visit_history .btn_visit_del[data-id]"))
          .find((button) => button.dataset.id === remove.dataset.id
            && (!remove.dataset.gtype || button.dataset.gtype === remove.dataset.gtype));
        original?.click();
      });
      clearButton?.addEventListener("click", () => {
        document.querySelector("#visit_history .visit_tablist .list_modi")?.click();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && strip.classList.contains("dcui-expanded")) setExpanded(false);
      });
    },

    bindControls(strip) {
      const viewport = strip.querySelector('[data-role="galleryStripViewport"]');
      if (!viewport) return;

      let activePointerId = null;
      let startX = 0;
      let startScrollLeft = 0;
      let dragged = false;
      let suppressClick = false;
      const finishDrag = (event) => {
        if (activePointerId === null || (event.pointerId !== undefined && event.pointerId !== activePointerId)) return;
        if (viewport.hasPointerCapture?.(activePointerId)) viewport.releasePointerCapture(activePointerId);
        activePointerId = null;
        viewport.classList.remove("dcui-dragging");
        this.updateControls(strip);
        window.setTimeout(() => {
          suppressClick = false;
        }, 0);
      };

      viewport.addEventListener("pointerdown", (event) => {
        if (strip.classList.contains("dcui-expanded") || !event.isPrimary || event.button !== 0) return;
        activePointerId = event.pointerId;
        startX = event.clientX;
        startScrollLeft = viewport.scrollLeft;
        dragged = false;
        suppressClick = false;
      });
      viewport.addEventListener("pointermove", (event) => {
        if (event.pointerId !== activePointerId) return;
        if (strip.classList.contains("dcui-expanded")) {
          finishDrag(event);
          return;
        }
        const distance = event.clientX - startX;
        if (!dragged && Math.abs(distance) > 7) {
          dragged = true;
          suppressClick = true;
          viewport.classList.add("dcui-dragging");
          viewport.setPointerCapture?.(activePointerId);
        }
        if (!dragged) return;
        viewport.scrollLeft = startScrollLeft - distance;
        event.preventDefault();
      });
      viewport.addEventListener("pointerup", finishDrag);
      viewport.addEventListener("pointercancel", finishDrag);
      viewport.addEventListener("lostpointercapture", finishDrag);
      viewport.addEventListener("click", (event) => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      viewport.addEventListener("dragstart", (event) => event.preventDefault());
      viewport.addEventListener("scroll", () => {
        this.updateControls(strip);
        if (strip.classList.contains("dcui-expanded")) this.renderExpandedRemainder(strip);
      }, { passive: true });
    },

    updateControls(strip) {
      const viewport = strip.querySelector('[data-role="galleryStripViewport"]');
      if (!viewport) return;
      viewport.classList.toggle("dcui-can-scroll", viewport.scrollWidth > viewport.clientWidth + 1);
    },

    injectStyle() {
      if (document.getElementById("dcui-gallery-strip-style")) return;
      const style = document.createElement("style");
      style.id = "dcui-gallery-strip-style";
      style.textContent = `
        #dcui-gallery-strip {
          display: none;
        }
        html.dcui-enabled #dcui-gallery-strip {
          display: block;
          border-bottom: 0;
          background: transparent;
          color: var(--dcui-color-text-soft);
          font: 12px/1.4 var(--dcui-font);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-inner {
          display: flex;
          box-sizing: border-box;
          width: var(--dcui-page-width);
          height: 36px;
          margin: 0 auto;
          padding: 5px;
          align-items: center;
          border-bottom: 1px solid var(--dcui-color-border-strong);
          background: var(--dcui-color-surface-notice);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-viewport {
          flex: 1;
          min-width: 0;
          height: 26px;
          overflow-x: auto;
          overflow-y: hidden;
          cursor: grab;
          touch-action: pan-y;
          user-select: none;
          scrollbar-width: none;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expand {
          display: inline-flex;
          flex: 0 0 26px;
          box-sizing: border-box;
          width: 26px;
          height: 26px;
          align-items: center;
          justify-content: center;
          margin-left: 5px;
          padding: 0;
          border: 1px solid var(--dcui-color-border-strong);
          border-radius: 2px;
          background: linear-gradient(var(--dcui-color-control-gradient-top), var(--dcui-color-control-gradient-bottom));
          color: var(--dcui-color-text-soft);
          font: 700 11px/24px var(--dcui-font);
          cursor: pointer;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expand:hover {
          border-color: var(--dcui-control-border-hover);
          color: var(--dcui-color-nav);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expand-icon {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-right: 1px solid currentColor;
          border-bottom: 1px solid currentColor;
          transform: translateY(-2px) rotate(45deg);
        }
        html.dcui-enabled #dcui-gallery-strip.dcui-expanded .dcui-gallery-strip-expand-icon {
          transform: translateY(2px) rotate(225deg);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-viewport::-webkit-scrollbar {
          display: none;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-viewport.dcui-dragging {
          cursor: grabbing;
        }
        html.dcui-enabled #dcui-gallery-strip.dcui-expanded .dcui-gallery-strip-viewport,
        html.dcui-enabled #dcui-gallery-strip.dcui-expanded .dcui-gallery-strip-viewport.dcui-dragging {
          cursor: default;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-track {
          display: flex;
          width: max-content;
          min-width: 100%;
          height: 26px;
          gap: 5px;
          align-items: stretch;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-group {
          display: flex;
          flex: 0 0 auto;
          gap: 5px;
          align-items: center;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-favorites {
          background: transparent;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-recents {
          border-left: 0;
          background: transparent;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-group a {
          flex: 0 0 auto;
          box-sizing: border-box;
          height: 26px;
          padding: 7px;
          border-radius: 5px;
          background: var(--dcui-color-surface-strong);
          color: var(--dcui-color-text-soft);
          font-size: 12px;
          font-weight: 700;
          line-height: 12px;
          text-decoration: none;
          white-space: nowrap;
          -webkit-user-drag: none;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-item {
          display: inline-flex;
          flex: 0 0 auto;
          height: 26px;
          align-items: stretch;
          overflow: hidden;
          border-radius: 5px;
        }
        html.dcui-enabled #dcui-gallery-strip.dcui-delete-mode .dcui-gallery-strip-item a {
          border-radius: 5px 0 0 5px;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-favorites a {
          background: var(--dcui-color-nav-light);
          color: var(--dcui-color-on-accent);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-group a:hover {
          background: var(--dcui-color-control-hover);
          color: var(--dcui-color-text-strong);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-favorites a:hover {
          background: var(--dcui-color-nav);
          color: #ffea00;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-empty {
          display: block;
          box-sizing: border-box;
          height: 26px;
          padding: 7px;
          border-radius: 5px;
          background: var(--dcui-color-surface-strong);
          color: var(--dcui-color-faint);
          font-size: 12px;
          line-height: 12px;
          white-space: nowrap;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded {
          box-sizing: border-box;
          width: var(--dcui-page-width);
          margin: 0 auto;
          padding: 5px 5px 0;
          border-bottom: 1px solid var(--dcui-color-border-strong);
          background: var(--dcui-color-surface-notice);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded[hidden] {
          display: none !important;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded-list {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded-list:empty {
          display: none;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded.dcui-no-expanded-items {
          padding-top: 0;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded-item {
          display: inline-flex;
          box-sizing: border-box;
          height: 26px;
          align-items: stretch;
          overflow: visible;
          border-radius: 5px;
          background: var(--dcui-color-surface-strong);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded-item.dcui-favorite {
          background: var(--dcui-color-nav-light);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded-item a {
          display: inline-flex;
          align-items: center;
          padding: 0 7px;
          color: var(--dcui-color-text-soft);
          font-size: 12px;
          font-weight: 700;
          line-height: 26px;
          text-decoration: none;
          white-space: nowrap;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded-item.dcui-favorite a {
          color: var(--dcui-color-on-accent);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded-item:hover {
          background: var(--dcui-color-control-hover);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded-item.dcui-favorite:hover {
          background: var(--dcui-color-nav);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-delete {
          display: none;
          width: 22px;
          padding: 0;
          border: 0;
          border-left: 1px solid var(--dcui-color-border-strong);
          background: var(--dcui-color-control-active);
          color: var(--dcui-color-muted);
          font: 700 16px/24px Arial, sans-serif;
          cursor: pointer;
        }
        html.dcui-enabled #dcui-gallery-strip.dcui-delete-mode .dcui-gallery-strip-delete,
        html.dcui-enabled #dcui-gallery-strip .dcui-delete-mode .dcui-gallery-strip-delete {
          display: block;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-delete:hover {
          background: #d9534f;
          color: var(--dcui-color-on-accent);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded-empty {
          padding: 5px 7px;
          color: var(--dcui-color-faint);
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-footer {
          display: flex;
          height: 29px;
          align-items: center;
          gap: 10px;
          margin-top: 5px;
          border-top: 1px solid var(--dcui-color-border);
          color: var(--dcui-color-muted);
          font-size: 11px;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-expanded-list:empty + .dcui-gallery-strip-footer {
          margin-top: 0;
          border-top: 0;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-footer button {
          padding: 0;
          border: 0;
          background: transparent;
          color: var(--dcui-color-muted);
          font: 11px/28px var(--dcui-font);
          cursor: pointer;
        }
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-footer button:hover,
        html.dcui-enabled #dcui-gallery-strip .dcui-gallery-strip-footer button[aria-pressed="true"] {
          color: var(--dcui-color-nav);
          text-decoration: underline;
        }
      `;
      document.documentElement.appendChild(style);
    },
  });

  let conceptAlarmTimer = 0;
  let conceptAlarmRunning = false;
  let conceptAlarmContext = null;
  let conceptAlarmParseCount = 0;
  let conceptAlarmUnchangedSkipCount = 0;
  let conceptAlarmRetainedParseNodes = 0;
  let conceptListRequest = null;
  let conceptListRequestKey = "";
  let conceptParsedFingerprint = "";
  let conceptParsedKey = "";
  let conceptParsedPosts = [];
  const CONCEPT_FEED_CACHE_TTL_MS = 10 * 60 * 1000;
  const ConceptAlarmController = Object.freeze({
    intervalMs: 15000,
    staleAfterMs: 10 * 60 * 1000,
    maxSeen: 500,

    isEnabled() {
      return GM_getValue(CONCEPT_ALARM_ENABLED_KEY, true) !== false;
    },

    syncDocumentState() {
      const root = document.documentElement;
      root.dataset.dcuiConceptAlarmEnabled = String(this.isEnabled());
      root.dataset.dcuiConceptAlarmScheduled = String(conceptAlarmTimer !== 0);
      root.dataset.dcuiConceptAlarmRunning = String(conceptAlarmRunning);
    },

    clearSchedule() {
      window.clearTimeout(conceptAlarmTimer);
      conceptAlarmTimer = 0;
      this.syncDocumentState();
    },

    setEnabled(enabled) {
      const value = Boolean(enabled);
      GM_setValue(CONCEPT_ALARM_ENABLED_KEY, value);
      const input = document.getElementById("dcui-enable-concept-alarm");
      if (input) input.checked = value;
      if (value) AutomatedRequestCoordinator.resume();
      this.scheduleDue(conceptAlarmContext);
    },

    mount(context) {
      if (context.isRealtimeBest) return;
      if (window.__dcConceptAlarmMounted) return;
      window.__dcConceptAlarmMounted = true;
      conceptAlarmContext = context;
      window.__dcConceptAlarmCheckNow = () => this.resume(context);
      window.__dcConceptAlarmState = () => ({
        enabled: this.isEnabled(),
        running: conceptAlarmRunning,
        scheduled: conceptAlarmTimer !== 0,
        paused: AutomatedRequestCoordinator.isPaused(),
        visibility: document.visibilityState,
        parseCount: conceptAlarmParseCount,
        unchangedSkipCount: conceptAlarmUnchangedSkipCount,
        retainedParseNodes: conceptAlarmRetainedParseNodes,
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") {
          this.stop();
          return;
        }
        AutomatedRequestCoordinator.resetLifecycle();
        this.scheduleDue(conceptAlarmContext);
      });
      window.addEventListener("pagehide", () => this.stop());
      window.addEventListener("pageshow", (event) => {
        if (!event.persisted) return;
        AutomatedRequestCoordinator.resetLifecycle();
        this.scheduleDue(conceptAlarmContext);
      });
      this.scheduleDue(context);
    },

    keyPrefix(context) {
      return `dcconcept:${context.galleryKey}`;
    },

    lastCheckedAt(context) {
      return Number(GM_getValue(`${this.keyPrefix(context)}:checkedAt`, 0)) || 0;
    },

    lastRequestedAt(context) {
      return Number(GM_getValue(`${this.keyPrefix(context)}:requestedAt`, 0)) || 0;
    },

    lastActivityAt(context) {
      return Math.max(this.lastCheckedAt(context), this.lastRequestedAt(context));
    },

    stop() {
      this.clearSchedule();
      AutomatedRequestCoordinator.stopLifecycle();
    },

    schedule(context, delay = this.intervalMs) {
      this.clearSchedule();
      if (!context
        || document.visibilityState !== "visible"
        || AutomatedRequestCoordinator.isPaused()) return;
      conceptAlarmTimer = window.setTimeout(() => {
        conceptAlarmTimer = 0;
        this.syncDocumentState();
        this.check(context);
      }, Math.max(0, delay));
      this.syncDocumentState();
    },

    scheduleDue(context) {
      if (!context
        || document.visibilityState !== "visible"
        || AutomatedRequestCoordinator.isPaused()) return;
      const elapsed = Date.now() - this.lastActivityAt(context);
      this.schedule(context, Math.max(0, this.intervalMs - elapsed));
    },

    resume(context) {
      AutomatedRequestCoordinator.resume();
      return this.check(context, { force: true });
    },

    async check(context, { force = false } = {}) {
      if (!context
        || conceptAlarmRunning
        || document.visibilityState !== "visible") return;
      if (AutomatedRequestCoordinator.isPaused() && !force) return;
      if (!force) {
        const elapsed = Date.now() - this.lastActivityAt(context);
        if (elapsed < this.intervalMs) {
          this.schedule(context, this.intervalMs - elapsed);
          return;
        }
      }

      conceptAlarmRunning = true;
      this.syncDocumentState();
      const keyPrefix = this.keyPrefix(context);
      try {
        const html = await this.requestList(context, { force });
        if (html === undefined) return;
        const now = Date.now();
        const scan = this.scanPostIds(html);
        if (!scan.fragment) throw new Error("개념글 목록을 찾지 못했습니다.");

        const previousListIds = GM_getValue(`${keyPrefix}:listIds`, []);
        const listUnchanged = Array.isArray(previousListIds)
          && previousListIds.length === scan.ids.length
          && previousListIds.every((id, index) => String(id) === scan.ids[index]);
        const lastCheckedAt = Number(GM_getValue(`${keyPrefix}:checkedAt`, 0)) || 0;
        const posts = scan.ids.length ? this.parsePosts(scan, context) : [];
        if (scan.ids.length && posts.length === 0) throw new Error("개념글 목록을 찾지 못했습니다.");
        if (listUnchanged) {
          GM_setValue(`${keyPrefix}:checkedAt`, now);
          conceptAlarmUnchangedSkipCount += 1;
          this.publishFeed(context, posts);
          return;
        }

        const previousIds = GM_getValue(`${keyPrefix}:seen`, []);
        const canCompare = Array.isArray(previousIds)
          && previousIds.length > 0
          && now - lastCheckedAt <= this.staleAfterMs;
        const seen = new Set(canCompare ? previousIds.map(String) : []);
        const added = canCompare ? posts.filter((post) => !seen.has(post.id)) : [];
        const mergedIds = [...new Set([...posts.map((post) => post.id), ...seen])].slice(0, this.maxSeen);

        GM_setValue(`${keyPrefix}:listIds`, scan.ids);
        GM_setValue(`${keyPrefix}:seen`, mergedIds);
        GM_setValue(`${keyPrefix}:checkedAt`, now);
        this.publishFeed(context, posts);

        if (this.isEnabled()) {
          for (const post of added.slice(0, 5).reverse()) this.notify(post, context);
        }
      } catch (error) {
        if (error?.name === "EmptyAutomatedResponseError") {
          console.warn("[DC 자동 요청] 빈 응답으로 모든 자동 요청을 중지했습니다.");
        } else if (error?.name !== "AbortError") {
          console.debug("[DC 개념글 알림] 확인 실패", error);
        }
      } finally {
        conceptAlarmRunning = false;
        this.syncDocumentState();
        if (document.visibilityState === "visible"
          && !AutomatedRequestCoordinator.isPaused()) {
          this.schedule(context);
        }
      }
    },

    mobileListUrl(context) {
      const section = context.galleryType === "mini"
        ? "mini"
        : (context.galleryType === "person" ? "person" : "board");
      const url = new URL(`https://m.dcinside.com/${section}/${encodeURIComponent(context.galleryId)}`);
      url.searchParams.set("recommend", "1");
      return url.href;
    },

    requestList(context, { force = false, skipDueCheck = false, navigationGapMs } = {}) {
      if (conceptListRequest && conceptListRequestKey === context.galleryKey) return conceptListRequest;
      const request = AutomatedRequestCoordinator.run((signal) => {
        GM_setValue(`${this.keyPrefix(context)}:requestedAt`, Date.now());
        if (typeof GM_xmlhttpRequest !== "function") {
          return fetch(context.urls.concept, {
            credentials: "include",
            cache: "no-store",
            signal,
          }).then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return AutomatedRequestCoordinator.requireNonEmpty(await response.text());
          });
        }

        return new Promise((resolveRequest, rejectRequest) => {
          let request = null;
          let settled = false;
          const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", abort);
            callback(value);
          };
          const abort = () => {
            request?.abort?.();
            finish(rejectRequest, AutomatedRequestCoordinator.abortError());
          };
          signal.addEventListener("abort", abort, { once: true });
          request = GM_xmlhttpRequest({
            method: "GET",
            url: this.mobileListUrl(context),
            anonymous: true,
            timeout: 10000,
            headers: {
              Accept: "text/html,application/xhtml+xml",
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
            },
            onload: (response) => {
              if (response.status < 200 || response.status >= 300) {
                finish(rejectRequest, new Error(`HTTP ${response.status}`));
                return;
              }
              try {
                finish(resolveRequest, AutomatedRequestCoordinator.requireNonEmpty(response.responseText));
              } catch (error) {
                finish(rejectRequest, error);
              }
            },
            onerror: () => finish(rejectRequest, new Error("모바일 개념글 요청 실패")),
            ontimeout: () => finish(rejectRequest, new Error("모바일 개념글 요청 시간 초과")),
            onabort: () => finish(rejectRequest, AutomatedRequestCoordinator.abortError()),
          });
          if (signal.aborted) abort();
        });
      }, {
        force,
        navigationGapMs,
        shouldRun: force || skipDueCheck
          ? null
          : () => Date.now() - this.lastActivityAt(context) >= this.intervalMs,
      });
      conceptListRequestKey = context.galleryKey;
      conceptListRequest = request.finally(() => {
        if (conceptListRequest !== sharedRequest) return;
        conceptListRequest = null;
        conceptListRequestKey = "";
      });
      const sharedRequest = conceptListRequest;
      return sharedRequest;
    },

    feedCacheKey(context) {
      return `${this.keyPrefix(context)}:feed`;
    },

    cachedFeed(context) {
      const cached = GM_getValue(this.feedCacheKey(context), null);
      if (!cached || !Array.isArray(cached.posts)) return null;
      return {
        savedAt: Number(cached.savedAt) || 0,
        posts: cached.posts.filter((post) => post && /^\d+$/.test(String(post.id)) && post.title && post.url),
      };
    },

    freshCachedFeed(context) {
      const cached = this.cachedFeed(context);
      if (!cached?.savedAt) return null;
      const age = Date.now() - cached.savedAt;
      return age >= 0 && age < CONCEPT_FEED_CACHE_TTL_MS ? cached : null;
    },

    publishFeed(context, posts) {
      const feed = { savedAt: Date.now(), posts: posts.slice(0, 12) };
      GM_setValue(this.feedCacheKey(context), feed);
      document.dispatchEvent(new CustomEvent("dcui:concept-feed", {
        detail: {
          galleryKey: context.galleryKey,
          posts: feed.posts,
          status: feed.posts.length ? "ready" : "empty",
        },
      }));
      return feed;
    },

    publishCachedFeed(context) {
      const cached = this.freshCachedFeed(context);
      if (!cached) return null;
      document.dispatchEvent(new CustomEvent("dcui:concept-feed", {
        detail: {
          galleryKey: context.galleryKey,
          posts: cached.posts,
          status: cached.posts.length ? "ready" : "empty",
        },
      }));
      return cached;
    },

    publishFeedError(context) {
      document.dispatchEvent(new CustomEvent("dcui:concept-feed", {
        detail: { galleryKey: context.galleryKey, posts: [], status: "error" },
      }));
    },

    async loadFeed(context) {
      const cached = this.freshCachedFeed(context);
      if (cached) this.publishCachedFeed(context);
      if (cached) return cached.posts;
      try {
        const html = await this.requestList(context, { skipDueCheck: true, navigationGapMs: 250 });
        if (html === undefined) return cached?.posts || [];
        const scan = this.scanPostIds(html);
        if (!scan.fragment) throw new Error("개념글 목록을 찾지 못했습니다.");
        const posts = scan.ids.length ? this.parsePosts(scan, context) : [];
        if (scan.ids.length && posts.length === 0) throw new Error("개념글 목록을 찾지 못했습니다.");
        this.publishFeed(context, posts);
        return posts;
      } catch (error) {
        if (error?.name === "EmptyAutomatedResponseError") {
          console.warn("[DC 자동 요청] 빈 응답으로 모든 자동 요청을 중지했습니다.");
        } else if (error?.name !== "AbortError") {
          console.debug("[DC 최신 개념글] 확인 실패", error);
        }
        if (!cached) this.publishFeedError(context);
        return cached?.posts || [];
      }
    },

    attributeValue(markup, name) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = markup.match(new RegExp(`\\s${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
      return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
    },

    hasClass(markup, className) {
      return this.attributeValue(markup, "class").split(/\s+/).includes(className);
    },

    fragmentByClass(html, tagNames, className) {
      const tags = tagNames.join("|");
      const openerPattern = new RegExp(`<(${tags})\\b[^>]*>`, "gi");
      for (const match of html.matchAll(openerPattern)) {
        if (!this.hasClass(match[0], className)) continue;
        const tagName = match[1].toLowerCase();
        const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
        tagPattern.lastIndex = match.index + match[0].length;
        let depth = 1;
        for (const tagMatch of html.matchAll(tagPattern)) {
          depth += /^<\//.test(tagMatch[0]) ? -1 : 1;
          if (depth !== 0) continue;
          return html.slice(match.index, tagMatch.index + tagMatch[0].length);
        }
        return "";
      }
      return "";
    },

    scanPostIds(html) {
      const mobileFragment = this.fragmentByClass(html, ["ul", "div"], "gall-detail-lst");
      if (mobileFragment) {
        const ids = [];
        const seen = new Set();
        for (const match of mobileFragment.matchAll(/<a\b[^>]*>/gi)) {
          const opener = match[0];
          if (!this.hasClass(opener, "lt")) continue;
          const href = this.attributeValue(opener, "href").replace(/&amp;/gi, "&");
          const id = href.match(/\/(\d+)\/?(?:[?#]|$)/)?.[1] || "";
          if (!id || seen.has(id)) continue;
          seen.add(id);
          ids.push(id);
        }
        return { fragment: mobileFragment, ids };
      }

      const desktopFragment = this.fragmentByClass(html, ["table"], "gall_list");
      if (!desktopFragment) return { fragment: "", ids: [] };
      const ids = [];
      const seen = new Set();
      for (const match of desktopFragment.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
        const row = match[0];
        const opener = row.match(/^<tr\b[^>]*>/i)?.[0] || "";
        if (!this.hasClass(opener, "ub-content")) continue;
        if (this.attributeValue(opener, "data-type") === "icon_notice") continue;
        const id = this.attributeValue(opener, "data-no");
        if (!/^\d+$/.test(id) || seen.has(id)) continue;
        if (!/class\s*=\s*(?:"[^"]*\bgall_tit\b[^"]*"|'[^']*\bgall_tit\b[^']*')[\s\S]*?<a\b[^>]*href\s*=\s*(?:"[^"]*\/board\/view[^\"]*"|'[^']*\/board\/view[^']*')/i.test(row)) continue;
        seen.add(id);
        ids.push(id);
      }
      return { fragment: desktopFragment, ids };
    },

    parsePosts(scan, context) {
      let fragmentHash = 2166136261;
      for (let index = 0; index < scan.fragment.length; index += 1) {
        fragmentHash ^= scan.fragment.charCodeAt(index);
        fragmentHash = Math.imul(fragmentHash, 16777619);
      }
      const fingerprint = `${scan.fragment.length}:${fragmentHash >>> 0}`;
      if (conceptParsedKey === context.galleryKey && conceptParsedFingerprint === fingerprint) {
        return conceptParsedPosts.map((post) => ({ ...post }));
      }
      const template = document.createElement("template");
      template.innerHTML = scan.fragment;
      const root = template.content;
      conceptAlarmParseCount += 1;
      const posts = [];
      const seen = new Set();

      const countText = (value) => cleanText(value).replace(/[^\d]/g, "") || "0";
      const addPost = (id, title, url, recommendCount = "0", commentCount = "0") => {
        if (!/^\d+$/.test(id) || !title || seen.has(id)) return;
        seen.add(id);
        posts.push({
          id,
          title,
          url,
          recommendCount: countText(recommendCount),
          commentCount: countText(commentCount),
        });
      };

      try {
        for (const link of root.querySelectorAll(".gall-detail-lst .gall-detail-lnktb > a.lt")) {
          const mobileUrl = new URL(link.getAttribute("href"), "https://m.dcinside.com/");
          const id = mobileUrl.pathname.match(/\/(\d+)\/?$/)?.[1] || "";
          const title = cleanText(link.querySelector(".subjectin")?.textContent || link.textContent);
          const row = link.closest(".gall-detail-lnktb");
          const recommend = [...link.querySelectorAll(".ginfo li")]
            .find((item) => cleanText(item.textContent).startsWith("추천"));
          const comments = row?.querySelector(":scope > a.rt .ct");
          addPost(
            id,
            title,
            this.desktopPostUrl(context, id),
            recommend?.querySelector("span")?.textContent || recommend?.textContent,
            comments?.textContent,
          );
        }

        for (const row of root.querySelectorAll("table.gall_list tr.ub-content[data-no]")) {
          const id = cleanText(row.getAttribute("data-no"));
          if (row.dataset.type === "icon_notice") continue;
          const link = row.querySelector('.gall_tit a[href*="/board/view"]');
          if (!link) continue;
          const titleNode = link.cloneNode(true);
          titleNode.querySelectorAll(".blind, .icon_img, .sp_img, .reply_numbox, .reply_num").forEach((node) => node.remove());
          const title = cleanText(titleNode.textContent);
          titleNode.replaceChildren();
          addPost(
            id,
            title,
            new URL(link.getAttribute("href"), context.urls.concept).href,
            row.querySelector(".gall_recommend")?.textContent,
            row.querySelector(".reply_num")?.textContent,
          );
        }
        conceptParsedKey = context.galleryKey;
        conceptParsedFingerprint = fingerprint;
        conceptParsedPosts = posts.map((post) => ({ ...post }));
        return posts;
      } finally {
        root.replaceChildren();
        conceptAlarmRetainedParseNodes = root.childNodes.length;
      }
    },

    desktopPostUrl(context, postId) {
      const url = new URL(context.urls.list);
      url.pathname = url.pathname.replace(/\/lists\/?$/, "/view/");
      url.searchParams.set("no", postId);
      url.searchParams.set("exception_mode", "recommend");
      url.searchParams.set("page", "1");
      return url.href;
    },

    notify(post, _context) {
      this.showToast(post);
    },

    showToast(post) {
      let stack = document.getElementById("dc-concept-alarm-stack");
      if (!stack) {
        stack = document.createElement("div");
        stack.id = "dc-concept-alarm-stack";
        document.body.appendChild(stack);
        this.injectStyle();
      }

      const toast = document.createElement("a");
      toast.href = post.url;
      toast.className = "dc-concept-alarm-toast";
      const heading = document.createElement("strong");
      heading.textContent = `개념글: ${post.title}`;
      toast.append(heading);
      stack.prepend(toast);
      while (stack.children.length > 3) stack.lastElementChild.remove();
      window.setTimeout(() => toast.remove(), 5000);
    },

    injectStyle() {
      if (document.getElementById("dc-concept-alarm-style")) return;
      const style = document.createElement("style");
      style.id = "dc-concept-alarm-style";
      style.textContent = `
        #dc-concept-alarm-stack {
          position: fixed;
          z-index: 11000;
          bottom: 18px;
          right: 18px;
          display: grid;
          width: min(330px, calc(100vw - 36px));
          gap: 7px;
          font-family: Arial, "Malgun Gothic", sans-serif;
        }
        #dc-concept-alarm-stack .dc-concept-alarm-toast {
          display: block;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          box-sizing: border-box;
          overflow: hidden;
          border: 1px solid var(--dcui-color-border-accent);
          padding: 10px 12px;
          background: var(--dcui-color-surface);
          color: var(--dcui-color-text-strong);
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
          text-align: left;
          text-decoration: none;
          cursor: pointer;
        }
        #dc-concept-alarm-stack strong,
        #dc-concept-alarm-stack span {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #dc-concept-alarm-stack strong {
          margin-bottom: 0;
          color: var(--dcui-color-nav);
          font-size: 12px;
        }
        #dc-concept-alarm-stack span {
          font-size: 12px;
        }
      `;
      document.documentElement.appendChild(style);
    },
  });

  const FeaturedPostsView = Object.freeze({
    maxItems: 7,

    mount(context) {
      const conceptActive = new URL(location.href).searchParams.get("exception_mode") === "recommend";
      if (context.pageType === "list" && !context.isRealtimeBest) this.injectStyle();
      if (context.pageType !== "list" || conceptActive || context.isRealtimeBest) {
        document.getElementById("dcui-featured-posts")?.remove();
        return null;
      }
      let section = document.getElementById("dcui-featured-posts");
      if (section) return section;

      section = document.createElement("section");
      section.id = "dcui-featured-posts";
      section.setAttribute("aria-label", "실시간 베스트와 최신 개념글");
      section.innerHTML = `
        <div class="dcui-featured-column dcui-featured-realtime">
          <h3><a data-role="realtimeHeading">실시간 베스트</a></h3>
          <ul data-role="realtimeList"></ul>
        </div>
        <div class="dcui-featured-column dcui-featured-concept">
          <h3><a data-role="conceptHeading"></a></h3>
          <ul data-role="conceptList"><li class="dcui-featured-status">개념글을 불러오는 중입니다.</li></ul>
        </div>
      `;
      this.renderRealtime(section);
      this.renderHeading(section, context);
      let conceptRendered = false;
      const renderConceptOnce = (posts, status = posts.length ? "ready" : "loading") => {
        if (conceptRendered) return false;
        if (posts.length) {
          this.renderConcept(section, posts);
        } else if (status === "empty") {
          this.renderConceptStatus(section, "등록된 개념글이 없습니다.");
        } else if (status === "error") {
          this.renderConceptStatus(section, "개념글을 불러오지 못했습니다.");
        } else {
          return false;
        }
        conceptRendered = true;
        document.removeEventListener("dcui:concept-feed", onConceptFeed);
        return true;
      };
      const onConceptFeed = (event) => {
        if (event.detail?.galleryKey !== context.galleryKey) return;
        renderConceptOnce(event.detail.posts || [], event.detail.status);
      };
      document.addEventListener("dcui:concept-feed", onConceptFeed);
      const cached = ConceptAlarmController.freshCachedFeed(context);
      if (cached) renderConceptOnce(cached.posts, cached.posts.length ? "ready" : "empty");
      ConceptAlarmController.loadFeed(context);
      return section;
    },

    renderHeading(section, context) {
      const heading = section.querySelector('[data-role="conceptHeading"]');
      if (!heading) return;
      const galleryName = cleanText(DcAdapter.galleryTitle()?.textContent)
        .replace(/\s*(?:(?:미니|마이너|인물)\s*)?갤러리\s*(?:미니|마이너|인물)?\s*$/, "")
        || context.galleryId;
      heading.href = context.urls.concept;
      heading.textContent = `${galleryName} 최신 개념글`;
    },

    realtimeLinks() {
      const source = document.querySelector(".r_timebest");
      if (!source) return [];
      const heading = source.querySelector("header .tit a, h3 a");
      const candidates = [
        ...source.querySelectorAll(".rcont_imgtxt_box > .txt a[href]"),
        ...source.querySelectorAll(".rcontimg_box a.inner[href]"),
      ];
      const seen = new Set();
      const links = [];
      for (const link of candidates) {
        const title = cleanText(link.querySelector("strong")?.textContent || link.textContent);
        const href = link.href;
        if (!title || !href || seen.has(href)) continue;
        seen.add(href);
        links.push({ title, href });
        if (links.length >= this.maxItems) break;
      }
      return { heading, links };
    },

    renderRealtime(section) {
      const feed = this.realtimeLinks();
      const heading = section.querySelector('[data-role="realtimeHeading"]');
      const list = section.querySelector('[data-role="realtimeList"]');
      if (!list) return;
      if (feed?.heading?.href) heading.href = feed.heading.href;
      list.replaceChildren();
      for (const post of feed?.links || []) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.className = "dcui-featured-title";
        link.href = post.href;
        link.textContent = post.title;
        link.title = post.title;
        item.appendChild(link);
        list.appendChild(item);
      }
      if (!list.childElementCount) {
        const empty = document.createElement("li");
        empty.className = "dcui-featured-status";
        empty.textContent = "표시할 실시간 베스트가 없습니다.";
        list.appendChild(empty);
      }
    },

    renderConcept(section, posts) {
      const list = section.querySelector('[data-role="conceptList"]');
      if (!list) return;
      list.replaceChildren();
      for (const post of posts.slice(0, this.maxItems)) {
        const item = document.createElement("li");
        const title = document.createElement("a");
        title.className = "dcui-featured-title";
        title.href = post.url;
        title.textContent = post.title;
        title.title = post.title;

        const comments = document.createElement("a");
        comments.className = "dcui-featured-comments";
        const commentUrl = new URL(post.url, location.href);
        commentUrl.hash = "focus_cmt";
        comments.href = commentUrl.href;
        comments.textContent = String(post.commentCount || "0");
        comments.setAttribute("aria-label", `댓글 ${post.commentCount || "0"}개`);

        const recommends = document.createElement("span");
        recommends.className = "dcui-featured-recommends";
        recommends.textContent = String(post.recommendCount || "0");
        recommends.setAttribute("aria-label", `추천 ${post.recommendCount || "0"}개`);
        item.append(title, comments, recommends);
        list.appendChild(item);
      }
      if (!list.childElementCount) {
        this.renderConceptStatus(section, "등록된 개념글이 없습니다.");
      }
    },

    renderConceptStatus(section, message) {
      const list = section.querySelector('[data-role="conceptList"]');
      if (!list) return;
      const status = document.createElement("li");
      status.className = "dcui-featured-status";
      status.textContent = message;
      list.replaceChildren(status);
    },

    injectStyle() {
      if (document.getElementById("dcui-featured-posts-style")) return;
      const style = document.createElement("style");
      style.id = "dcui-featured-posts-style";
      style.textContent = `
        #dcui-featured-posts { display: none; }
        html.dcui-enabled #dcui-featured-posts {
          display: grid;
          box-sizing: border-box;
          width: 100%;
          grid-template-columns: 49% 49%;
          column-gap: 2%;
          margin: 0 0 12px;
          padding: 0 13px 10px;
          border: 0;
          background: var(--dcui-color-surface);
          font-family: Arial, "Malgun Gothic", sans-serif;
        }
        html.dcui-enabled #container:has(#dcui-featured-posts) {
          margin-top: 5px !important;
        }
        html.dcui-enabled.dcui-gallery-major #gall_top_recom {
          display: none !important;
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-column {
          min-width: 0;
        }
        html.dcui-enabled #dcui-featured-posts h3 {
          height: 27px;
          margin: 0;
          border: 0;
          font-size: 16px;
          line-height: 26px;
        }
        html.dcui-enabled.dcui-featured-hidden #dcui-featured-posts {
          display: none !important;
        }
        html.dcui-enabled #dcui-featured-posts h3 a {
          color: var(--dcui-color-nav);
          font-weight: 700;
          text-decoration: none;
        }
        html.dcui-enabled #dcui-featured-posts h3 a:hover,
        html.dcui-enabled #dcui-featured-posts h3 a:focus-visible {
          text-decoration: underline;
        }
        html.dcui-enabled #dcui-featured-posts ul {
          margin: 5px 0 0;
          padding: 0;
          list-style: none;
        }
        html.dcui-enabled #dcui-featured-posts li {
          display: flex;
          box-sizing: border-box;
          min-width: 0;
          height: 22px;
          align-items: center;
          gap: 6px;
          padding: 2px 0 3px;
          font-size: 12px;
          line-height: 17px;
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-title {
          display: block;
          min-width: 0;
          flex: 1 1 auto;
          overflow: hidden;
          color: var(--dcui-color-featured-title);
          text-overflow: ellipsis;
          white-space: nowrap;
          text-decoration: none;
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-title:visited {
          color: var(--dcui-color-featured-visited);
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-title::before {
          content: "·";
          margin-right: 5px;
          color: var(--dcui-color-faint);
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-title:hover,
        html.dcui-enabled #dcui-featured-posts .dcui-featured-title:focus-visible {
          color: var(--dcui-color-nav);
          text-decoration: underline;
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-comments,
        html.dcui-enabled #dcui-featured-posts .dcui-featured-recommends {
          flex: 0 0 auto;
          font-size: 11px;
          text-decoration: none;
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-comments {
          color: var(--dcui-color-link-bright);
          font-weight: 700;
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-comments::before {
          content: "[";
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-comments::after {
          content: "]";
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-recommends {
          min-width: 25px;
          color: var(--dcui-color-muted);
          text-align: right;
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-recommends::before {
          content: "▲";
          margin-right: 2px;
          color: var(--dcui-color-faint);
          font-size: 8px;
        }
        html.dcui-enabled #dcui-featured-posts .dcui-featured-status {
          color: var(--dcui-color-faint);
        }
      `;
      document.documentElement.appendChild(style);
    },
  });

  const ShellView = Object.freeze({
    mount(context) {
      const siteRoot = DcAdapter.siteRoot();
      const contentWrap = DcAdapter.contentWrap();
      const container = DcAdapter.container();
      const leftContent = DcAdapter.leftContent();
      if (!siteRoot || !contentWrap || !container || !leftContent) return null;

      const existing = document.getElementById("dcui-shell");
      if (existing) return this.elements(existing, document.getElementById("dcui-sidebar"));

      const originalLoginLink = DcAdapter.loginLink();
      const shell = document.createElement("header");
      shell.id = "dcui-shell";
      shell.innerHTML = `
        <div class="dcui-utility">
          <div class="dcui-inner">
            <p>CONNECTING HEARTS! 디시인사이드입니다.</p>
            <nav aria-label="사용자 메뉴">
              <a data-role="myInfo">내 정보</a>
              <a data-role="myPosts">내 글</a>
              <a data-role="myComments">내 댓글</a>
              <div class="dcui-native-alarm-mount" data-role="nativeAlarmMount">
                <button type="button" data-role="nativeAlarm">내 알림<em aria-hidden="true"></em></button>
              </div>
              <a data-role="login">로그인</a>
              <div class="dcui-native-dark-mode-mount" data-role="nativeDarkModeMount"></div>
              <div class="dcui-theme-toggle-mount" data-role="themeToggleMount"></div>
            </nav>
          </div>
        </div>
        <div class="dcui-brand-row dcui-inner">
          <div class="dcui-brand-slot" data-role="brandSlot">
            <a class="dcui-brand dcui-brand-fallback" data-role="listLink">
              <strong>디시인사이드</strong><span>dcinside.com</span>
            </a>
          </div>
          <div class="dcui-search-slot" data-role="searchSlot"></div>
        </div>
        <div class="dcui-nav-bar">
          <nav class="dcui-inner" aria-label="갤러리 메뉴">
            <div class="dcui-gallery-menu">
              <a class="dcui-active" data-role="galleryHome">갤러리</a>
            </div>
            <a data-role="minorHome">마이너갤</a>
            <a data-role="miniHome">미니갤</a>
            <a data-role="personHome">인물갤</a>
          </nav>
        </div>
      `;

      const loginLink = shell.querySelector('[data-role="login"]');
      loginLink.href = originalLoginLink?.href || "https://sign.dcinside.com/login";
      loginLink.textContent = cleanText(originalLoginLink?.textContent) || "로그인";
      shell.querySelector('[data-role="listLink"]').href = context.urls.list;
      shell.querySelector('[data-role="galleryHome"]').href = new URL("/", context.urls.galleryHome).href;
      shell.querySelector('[data-role="minorHome"]').href = new URL("/m", context.urls.galleryHome).href;
      shell.querySelector('[data-role="miniHome"]').href = new URL("/n", context.urls.galleryHome).href;
      shell.querySelector('[data-role="personHome"]').href = new URL("/p", context.urls.galleryHome).href;
      shell.querySelectorAll(".dcui-nav-bar > nav > a, .dcui-gallery-menu > a")
        .forEach((link) => link.classList.remove("dcui-active"));
      const activeNavRole = {
        major: "galleryHome",
        minor: "minorHome",
        mini: "miniHome",
        person: "personHome",
      }[context.galleryType] || "galleryHome";
      shell.querySelector(`[data-role="${activeNavRole}"]`)?.classList.add("dcui-active");

      const originalLogo = DcAdapter.logo();
      if (originalLogo) {
        originalLogo.classList.add("dcui-brand", "dcui-native-logo");
        shell.querySelector('[data-role="brandSlot"]').replaceChildren(originalLogo);
      }

      const isLoggedIn = Boolean(DcAdapter.loginBox()?.querySelector(".btn_inout.logout"))
        || cleanText(originalLoginLink?.textContent).includes("로그아웃");
      if (isLoggedIn) {
        const nativeLogout = DcAdapter.loginBox()?.querySelector(".btn_inout.logout");
        loginLink.textContent = "로그아웃";
        if (nativeLogout?.href) loginLink.href = nativeLogout.href;
      }
      const gallogBase = DcAdapter.ownGallogUrl().replace(/\/$/, "");
      shell.querySelector('[data-role="myInfo"]').href = gallogBase || "https://gallog.dcinside.com/";
      shell.querySelector('[data-role="myPosts"]').href = `${gallogBase}/posting`;
      shell.querySelector('[data-role="myComments"]').href = `${gallogBase}/comment`;
      for (const link of shell.querySelectorAll('[data-role="myInfo"], [data-role="myPosts"], [data-role="myComments"]')) {
        link.hidden = !isLoggedIn;
      }

      this.mountNativeAlarm(shell, loginLink);
      this.mountNativeDarkMode(shell);
      ThemeController.mountScreenToggle(shell.querySelector('[data-role="themeToggleMount"]'));

      const searchWrap = DcAdapter.searchWrap();
      if (searchWrap) {
        const searchInput = searchWrap.querySelector('input[type="text"], input:not([type])');
        if (searchInput) searchInput.placeholder = "게시판명 & 통합검색";
        shell.querySelector('[data-role="searchSlot"]').appendChild(searchWrap);
      }
      const visitHistory = document.getElementById("visit_history");
      siteRoot.insertBefore(shell, visitHistory || contentWrap);
      GalleryStripView.mount(siteRoot, shell, visitHistory || contentWrap);

      let rightContent = DcAdapter.rightContent();
      if (!rightContent) {
        rightContent = document.createElement("section");
        rightContent.className = "right_content dcui-created-right-content";
        container.insertBefore(rightContent, leftContent.nextSibling);
      }

      const sidebar = document.createElement("aside");
      sidebar.id = "dcui-sidebar";
      sidebar.innerHTML = `
        <section class="dcui-side-card dcui-hotkeys">
          <div class="dcui-side-title">
            <strong>단축키</strong>
          </div>
          <ul data-role="shortcutList">
            <li><kbd>alt+c</kbd><a href="#" data-role="sideComment">댓글 쓰기</a></li>
            <li><kbd>alt+w</kbd><a data-role="sideWrite">글 쓰기</a></li>
            <li><kbd>alt+q</kbd><button type="button" data-role="sideRegister">댓글 등록</button></li>
            <li><kbd>e</kbd><a href="#dcui-shell">상단으로</a></li>
            <li><kbd>d</kbd><a href="#footer">하단으로</a></li>
            ${context.pageType === "view" ? '<li><kbd>c</kbd><a href="#" data-role="sideComments">댓글로</a></li>' : ""}
            <li><kbd>s</kbd><a href="#" data-role="sidePrevious">이전</a></li>
            <li><kbd>f</kbd><a href="#" data-role="sideNext">다음</a></li>
            <li><kbd>q</kbd><a data-role="sideMain">메인</a></li>
            <li><kbd>w</kbd><a data-role="sideConcept">개념글</a></li>
          </ul>
        </section>
      `;
      this.mountGallerySettings(sidebar);
      const conceptShortcut = sidebar.querySelector('[data-role="sideConcept"]');
      const writeShortcut = sidebar.querySelector('[data-role="sideWrite"]');
      if (context.isRealtimeBest) {
        conceptShortcut?.closest("li")?.remove();
        writeShortcut?.closest("li")?.remove();
      } else {
        conceptShortcut.href = context.urls.concept;
        writeShortcut.href = context.urls.write;
      }
      sidebar.querySelector('[data-role="sideMain"]').href = context.urls.list;
      this.mountFavoriteShortcuts(sidebar);
      rightContent.prepend(sidebar);
      this.bindShortcuts(context, sidebar);
      if (context.pageType === "view") this.pruneNativeViewRail(rightContent, sidebar);

      this.injectStyle();
      const elements = this.elements(shell, sidebar);
      return elements;
    },

    pruneNativeViewRail(rightContent, sidebar) {
      rightContent.replaceChildren(sidebar);
      const removeResidue = () => {
        for (const node of document.querySelectorAll("#login_box, .rightbanner1, .r_timebest, .r_dcmedia, .r_recommend")) {
          if (node.closest("#dcui-shell, #dcui-sidebar")) continue;
          const nativeRail = node.closest(".right_content");
          if (nativeRail && !nativeRail.contains(sidebar)) {
            nativeRail.remove();
            continue;
          }
          const article = node.closest("article");
          if (article && /r_(?:timebest|dcmedia|recommend)/.test(node.className)) article.remove();
          else node.remove();
        }
      };
      removeResidue();
      if (typeof MutationObserver !== "function") return;
      const observer = new MutationObserver(removeResidue);
      observer.observe(document.body, { childList: true, subtree: true });
      window.setTimeout(() => observer.disconnect(), 5000);
    },

    mountGallerySettings(sidebar) {
      const settingButton = document.querySelector("#issue_setting, .gall_issuebox .issue_setting");
      const bundle = settingButton?.closest(".bundle");
      if (!settingButton || !bundle || sidebar.querySelector(".dcui-gallery-settings")) return null;

      const card = document.createElement("section");
      card.className = "dcui-side-card dcui-gallery-settings";
      card.innerHTML = `
        <div class="dcui-side-title">
          <strong>설정</strong>
          <button type="button" class="dcui-gallery-settings-toggle" aria-controls="dcui-gallery-settings-body">숨기기</button>
        </div>
        <div class="dcui-gallery-settings-body" id="dcui-gallery-settings-body"></div>
      `;
      const settingsBody = card.querySelector(".dcui-gallery-settings-body");
      const visibilityToggle = card.querySelector(".dcui-gallery-settings-toggle");
      const syncVisibility = (collapsed) => {
        card.classList.toggle("dcui-gallery-settings-collapsed", collapsed);
        settingsBody.hidden = collapsed;
        visibilityToggle.textContent = collapsed ? "보이기" : "숨기기";
        visibilityToggle.setAttribute("aria-expanded", String(!collapsed));
      };
      syncVisibility(GM_getValue(SETTINGS_COLLAPSED_KEY, true) !== false);
      visibilityToggle.addEventListener("click", () => {
        const collapsed = !card.classList.contains("dcui-gallery-settings-collapsed");
        if (collapsed) SettingsModalView.close();
        GM_setValue(SETTINGS_COLLAPSED_KEY, collapsed);
        syncVisibility(collapsed);
      });
      settingButton.classList.add("dcui-gallery-settings-button");
      bundle.classList.add("dcui-gallery-settings-bundle");
      const settingList = bundle.querySelector(".setting_list");
      settingList?.classList.add("dcui-gallery-settings-list");
      if (settingList) settingList.style.display = "block";
      CustomSettingsController.mount(settingList);
      this.ensureNativeSettingsAnchor();
      card.querySelector(".dcui-gallery-settings-body").appendChild(bundle);
      sidebar.querySelector(".dcui-hotkeys")?.insertAdjacentElement("afterend", card);
      SettingsModalView.mount(card);
      return card;
    },

    mountFavoriteShortcuts(sidebar) {
      let emptyConfirmationTimer = 0;
      const card = sidebar.querySelector(".dcui-hotkeys");
      const normalizeFavorites = (favorites) => (Array.isArray(favorites) ? favorites : [])
        .flatMap((favorite) => {
          const name = cleanText(favorite?.name);
          const href = favorite?.href ? galleryBoardHref(String(favorite.href)) : "";
          return name && href ? [{ name, href }] : [];
        })
        .slice(0, 10);
      const render = (favoriteLinks) => {
        const list = sidebar.querySelector('[data-role="shortcutList"]');
        if (!list) return;
        list.querySelectorAll(".dcui-favorite-shortcut").forEach((item) => item.remove());
        const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
        for (const [index, favorite] of (favoriteLinks || []).slice(0, keys.length).entries()) {
          const item = document.createElement("li");
          item.className = "dcui-favorite-shortcut";
          item.dataset.shortcutKey = keys[index];
          const key = document.createElement("kbd");
          key.textContent = keys[index];
          const link = document.createElement("a");
          link.href = galleryBoardHref(favorite.href);
          link.dataset.role = `sideFavorite${index + 1}`;
          link.textContent = favorite.name;
          link.title = favorite.name;
          item.append(key, link);
          list.appendChild(item);
        }
      };
      let cachedFavorites = normalizeFavorites(GM_getValue(FAVORITE_SHORTCUT_CACHE_KEY, []));
      let cacheReady = GM_getValue(FAVORITE_SHORTCUT_CACHE_READY_KEY, false) === true;
      const revealCard = () => card?.classList.remove("dcui-hotkeys-favorites-pending");
      const applyFavorites = (favoriteLinks) => {
        const normalized = normalizeFavorites(favoriteLinks);
        if (normalized.length > 0) {
          window.clearTimeout(emptyConfirmationTimer);
          emptyConfirmationTimer = 0;
          cachedFavorites = normalized;
          cacheReady = true;
          GM_setValue(FAVORITE_SHORTCUT_CACHE_KEY, normalized);
          GM_setValue(FAVORITE_SHORTCUT_CACHE_READY_KEY, true);
          render(normalized);
          revealCard();
          return;
        }
        if (cachedFavorites.length === 0 && cacheReady) {
          render([]);
          revealCard();
          return;
        }
        if (emptyConfirmationTimer) return;
        emptyConfirmationTimer = window.setTimeout(() => {
          emptyConfirmationTimer = 0;
          const liveFavorites = normalizeFavorites(GalleryStripView.collectLinks([
            "#visit_history .bkmark_listbox a",
            "#visit_history .under_listbox.bkmark a",
          ]));
          if (liveFavorites.length > 0) {
            applyFavorites(liveFavorites);
            return;
          }
          cachedFavorites = [];
          cacheReady = true;
          GM_setValue(FAVORITE_SHORTCUT_CACHE_KEY, []);
          GM_setValue(FAVORITE_SHORTCUT_CACHE_READY_KEY, true);
          render([]);
          revealCard();
        }, 3200);
      };
      const strip = document.getElementById("dcui-gallery-strip");
      const initialFavorites = normalizeFavorites(strip?.__dcuiGalleryData?.favoriteLinks || GalleryStripView.collectLinks([
        "#visit_history .bkmark_listbox a",
        "#visit_history .under_listbox.bkmark a",
      ]));
      if (initialFavorites.length > 0) applyFavorites(initialFavorites);
      else {
        if (!cacheReady && cachedFavorites.length === 0) {
          card?.classList.add("dcui-hotkeys-favorites-pending");
        }
        render(cachedFavorites);
        applyFavorites([]);
      }
      document.addEventListener("dcui:favorites-updated", (event) => {
        applyFavorites(event.detail?.favoriteLinks || []);
      });
    },

    ensureNativeSettingsAnchor() {
      if (document.querySelector("#container header .gall_issuebox")) return;
      const container = document.querySelector("#container");
      if (!container || container.querySelector(".dcui-native-settings-anchor")) return;
      const anchor = document.createElement("header");
      anchor.className = "dcui-native-settings-anchor";
      anchor.innerHTML = '<span class="gall_issuebox"></span>';
      container.prepend(anchor);
    },

    mountNativeAlarm(shell, loginLink) {
      const nativeLink = DcAdapter.nativeAlarmLink();
      const nativePanel = DcAdapter.nativeAlarmPanel();
      const nativeSettings = document.getElementById("alarmConf");
      const mount = shell.querySelector('[data-role="nativeAlarmMount"]');
      const button = shell.querySelector('[data-role="nativeAlarm"]');
      const indicator = button.querySelector("em");

      if (nativePanel && mount) mount.appendChild(nativePanel);
      if (nativeSettings && mount) mount.appendChild(nativeSettings);

      const syncUnread = () => {
        indicator.classList.toggle("dcui-has-native-alarm", Boolean(nativeLink?.querySelector(".icon_noti.new")));
      };
      syncUnread();
      if (nativeLink && typeof MutationObserver === "function") {
        const observer = new MutationObserver(syncUnread);
        observer.observe(nativeLink, { attributes: true, childList: true, subtree: true });
      }

      button.addEventListener("click", () => {
        if (nativeSettings) nativeSettings.style.display = "none";
        if (nativeLink) {
          const wasVisible = nativePanel && getComputedStyle(nativePanel).display !== "none";
          nativeLink.click();
          if (nativePanel) {
            window.setTimeout(() => {
              const isVisible = getComputedStyle(nativePanel).display !== "none";
              if (wasVisible) nativePanel.style.display = "none";
              else if (!isVisible) nativePanel.style.display = "block";
            }, 0);
          }
          return;
        }
        if (nativePanel) {
          nativePanel.style.display = getComputedStyle(nativePanel).display === "none" ? "block" : "none";
          return;
        }
        loginLink.click();
      });
    },

    mountNativeDarkMode(shell) {
      const mount = shell.querySelector('[data-role="nativeDarkModeMount"]');
      const nativeDarkMode = document.querySelector("#top > .dcheader .area_links > .darkmodebox, .dcheader .area_links > .darkmodebox");
      const nativeLink = nativeDarkMode?.querySelector(":scope > .darkonoff");
      if (!mount || !nativeDarkMode || !nativeLink) {
        if (mount) mount.hidden = true;
        return null;
      }
      if (!document.getElementById("dcui-native-dark-mode-anchor")) {
        const anchor = document.createElement("span");
        anchor.id = "dcui-native-dark-mode-anchor";
        anchor.hidden = true;
        nativeDarkMode.insertAdjacentElement("beforebegin", anchor);
      }
      nativeDarkMode.classList.add("dcui-native-dark-mode");
      mount.appendChild(nativeDarkMode);
      return nativeLink;
    },

    bindShortcuts(context, sidebar) {
      if (document.documentElement.dataset.dcuiShortcuts === "true") return;
      document.documentElement.dataset.dcuiShortcuts = "true";

      sidebar.querySelector('[data-role="sideComment"]')?.addEventListener("click", (event) => {
        event.preventDefault();
        const textarea = document.querySelector(".cmt_write_box textarea");
        textarea?.scrollIntoView({ behavior: "smooth", block: "center" });
        textarea?.focus({ preventScroll: true });
      });
      sidebar.querySelector('[data-role="sideComments"]')?.addEventListener("click", (event) => {
        event.preventDefault();
        document.querySelector(".dcui-comments")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      sidebar.querySelector('[data-role="sideRegister"]')?.addEventListener("click", () => {
        const submit = [...document.querySelectorAll(".cmt_write_box button")]
          .find((button) => cleanText(button.textContent).includes("등록"));
        submit?.click();
      });

      const previousShortcut = sidebar.querySelector('[data-role="sidePrevious"]');
      const nextShortcut = sidebar.querySelector('[data-role="sideNext"]');
      const syncDirectionalShortcuts = () => {
        this.configureDirectionalShortcuts(context, previousShortcut, nextShortcut);
      };
      syncDirectionalShortcuts();
      if (context.pageType === "list") {
        for (const shortcut of [previousShortcut, nextShortcut]) {
          shortcut?.addEventListener("click", (event) => {
            if (event.defaultPrevented || event.button !== 0
              || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            const targetHref = shortcut.getAttribute("href");
            if (!targetHref) return;
            const target = new URL(targetHref, location.href);
            const nativePage = [...document.querySelectorAll(".bottom_paging_box a[href]")]
              .find((link) => {
                const candidate = new URL(link.href, location.href);
                return candidate.origin === target.origin
                  && candidate.pathname.replace(/\/$/, "") === target.pathname.replace(/\/$/, "")
                  && candidate.searchParams.get("id") === target.searchParams.get("id")
                  && (candidate.searchParams.get("page") || "1") === (target.searchParams.get("page") || "1");
              });
            if (!nativePage) return;
            event.preventDefault();
            nativePage.click();
          });
        }
      }
      if (context.pageType === "view") {
        previousShortcut?.addEventListener("click", (event) => {
          event.preventDefault();
          this.navigateVisiblePost(previousShortcut, -1);
        });
        nextShortcut?.addEventListener("click", (event) => {
          event.preventDefault();
          this.navigateVisiblePost(nextShortcut, 1);
        });
      }

      document.addEventListener("keydown", (event) => {
        const target = event.target;
        const isTyping = target instanceof HTMLElement
          && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
        if (event.defaultPrevented || isTyping || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const refresherPreviewOpen = [...document.querySelectorAll(".refresher-frame-outer")]
          .some((frame) => {
            const style = getComputedStyle(frame);
            return !frame.classList.contains("fadeOut") && frame.getClientRects().length > 0
              && style.visibility !== "hidden" && style.pointerEvents !== "none"
              && (frame.classList.contains("fadeIn") || Number.parseFloat(style.opacity) > 0);
          });
        if (refresherPreviewOpen) return;

        const key = event.key.toLowerCase();
        if (event.altKey) {
          if (key === "w") {
            event.preventDefault();
            location.assign(context.urls.write);
          } else if (key === "c" && context.pageType === "view") {
            event.preventDefault();
            sidebar.querySelector('[data-role="sideComment"]')?.click();
          } else if (key === "q" && context.pageType === "view") {
            event.preventDefault();
            sidebar.querySelector('[data-role="sideRegister"]')?.click();
          }
          return;
        }

        if (key === "e") {
          event.preventDefault();
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else if (key === "d") {
          event.preventDefault();
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
        } else if (key === "c" && context.pageType === "view") {
          event.preventDefault();
          sidebar.querySelector('[data-role="sideComments"]')?.click();
        } else if (key === "s") {
          event.preventDefault();
          if (context.pageType === "view") this.navigateVisiblePost(previousShortcut, -1);
          else previousShortcut?.click();
        } else if (key === "f") {
          event.preventDefault();
          if (context.pageType === "view") this.navigateVisiblePost(nextShortcut, 1);
          else nextShortcut?.click();
        } else if (key === "q") {
          event.preventDefault();
          sidebar.querySelector('[data-role="sideMain"]')?.click();
        } else if (key === "w") {
          event.preventDefault();
          location.assign(context.urls.concept);
        } else if (/^[0-9]$/.test(key)) {
          const favorite = sidebar.querySelector(`.dcui-favorite-shortcut[data-shortcut-key="${key}"] a`);
          if (!favorite) return;
          event.preventDefault();
          favorite.click();
        }
      });
    },

    configureDirectionalShortcuts(context, previousShortcut, nextShortcut) {
      const setTarget = (control, href, label) => {
        if (!control) return;
        if (control.dataset.dcuiDisabledGuard !== "true") {
          control.dataset.dcuiDisabledGuard = "true";
          control.addEventListener("click", (event) => {
            if (control.getAttribute("aria-disabled") === "true") event.preventDefault();
          });
        }
        if (href) {
          control.href = href;
          control.removeAttribute("aria-disabled");
          control.title = label;
          return;
        }
        control.removeAttribute("href");
        control.setAttribute("aria-disabled", "true");
        control.title = `${label} 없음`;
      };

      if (context.pageType === "list") {
        const currentUrl = new URL(location.href);
        const currentPage = Math.max(1, Number.parseInt(currentUrl.searchParams.get("page") || "1", 10) || 1);
        const totalPage = Number.parseInt(document.querySelector(".move_page_lyr .total_page")?.textContent || "", 10);
        const pageHref = (page) => {
          const target = new URL(currentUrl);
          target.searchParams.set("page", String(page));
          return galleryBoardHref(target.href);
        };
        setTarget(previousShortcut, currentPage > 1 ? pageHref(currentPage - 1) : "", "이전 페이지");
        setTarget(nextShortcut, Number.isFinite(totalPage) && currentPage >= totalPage ? "" : pageHref(currentPage + 1), "다음 페이지");
        return;
      }

      const currentNo = new URL(location.href).searchParams.get("no") || "";
      const rows = [...document.querySelectorAll("#bottom_listwrap table.gall_list tr.ub-content")]
        .filter((row) => row.getClientRects().length > 0)
        .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
      const postLink = (row) => row?.querySelector('.gall_tit a[href*="/view/"][href*="no="]') || null;
      const postNo = (row) => {
        try {
          return new URL(postLink(row)?.href || "", location.href).searchParams.get("no") || "";
        } catch (_error) {
          return "";
        }
      };
      const isRegularPost = (row) => {
        const numberText = cleanText(row?.querySelector(".gall_num")?.textContent);
        const subjectText = cleanText(row?.querySelector(".gall_subject")?.textContent);
        const rowType = cleanText(row?.dataset.type);
        return Boolean(postLink(row))
          && !["공지", "설문", "AD"].includes(numberText)
          && !["공지", "설문", "AD"].includes(subjectText)
          && !["icon_notice", "icon_survey", "icon_ad"].includes(rowType);
      };
      const currentIndex = rows.findIndex((row) => postNo(row) === currentNo);
      const adjacentHref = (step) => {
        if (currentIndex < 0) return "";
        for (let index = currentIndex + step; index >= 0 && index < rows.length; index += step) {
          if (isRegularPost(rows[index])) return postLink(rows[index]).href;
        }
        return "";
      };
      const previousHref = adjacentHref(-1);
      const nextHref = adjacentHref(1);
      setTarget(previousShortcut, previousHref, "이전 게시글");
      setTarget(nextShortcut, nextHref, "다음 게시글");
    },

    async navigateVisiblePost(control, direction) {
      if (!control || control.dataset.dcuiPostResolving === "true") return;
      control.dataset.dcuiPostResolving = "true";
      const sourceHref = location.href;
      try {
        const href = await this.resolveVisiblePostHref(direction);
        if (href && location.href === sourceHref) location.assign(href);
      } finally {
        delete control.dataset.dcuiPostResolving;
      }
    },

    async resolveVisiblePostHref(direction) {
      const listUrl = new URL(location.href);
      listUrl.pathname = listUrl.pathname.replace(/\/view\/?$/, "/lists/");
      listUrl.searchParams.delete("no");
      const currentPage = Math.max(1, Number.parseInt(listUrl.searchParams.get("page") || "1", 10) || 1);
      const currentNo = new URL(location.href).searchParams.get("no") || "";

      try {
        const readPage = async (page) => {
          const target = new URL(listUrl);
          target.searchParams.set("page", String(page));
          const response = await fetch(galleryBoardHref(target.href), { credentials: "same-origin" });
          if (!response.ok) return [];
          const doc = new DOMParser().parseFromString(await response.text(), "text/html");
          return [...doc.querySelectorAll("table.gall_list tr.ub-content")].flatMap((row) => {
            const link = row.querySelector('.gall_tit a[href*="/view/"][href*="no="]');
            const numberText = cleanText(row.querySelector(".gall_num")?.textContent);
            const subjectText = cleanText(row.querySelector(".gall_subject")?.textContent);
            const rowType = cleanText(row.dataset.type);
            if (!link
              || ["공지", "설문", "AD"].includes(numberText)
              || ["공지", "설문", "AD"].includes(subjectText)
              || ["icon_notice", "icon_survey", "icon_ad"].includes(rowType)) return [];
            const href = new URL(link.getAttribute("href") || "", target.href).href;
            return [{ href, no: new URL(href).searchParams.get("no") || "" }];
          });
        };
        const posts = await readPage(currentPage);
        const currentIndex = posts.findIndex((post) => post.no === currentNo);
        const local = currentIndex >= 0 ? posts[currentIndex + direction]?.href || "" : "";
        if (local) return local;
        const boundaryPage = currentPage + direction;
        if (currentIndex < 0 || boundaryPage < 1) return "";
        const boundaryPosts = await readPage(boundaryPage);
        return direction < 0 ? boundaryPosts.at(-1)?.href || "" : boundaryPosts[0]?.href || "";
      } catch (_error) {
        return "";
      }
    },

    elements(shell, sidebar) {
      return {
        shell,
        sidebar,
        alarmState: sidebar?.querySelector('[data-role="alarmState"]') || null,
        alarmMessage: sidebar?.querySelector('[data-role="alarmMessage"]') || null,
      };
    },

    updateAlarm(elements, running, message) {
      if (!elements) return;
      if (elements.alarmState) {
        elements.alarmState.textContent = running ? "ON" : "OFF";
        elements.alarmState.classList.toggle("dcui-on", running);
      }
      if (elements.alarmMessage) elements.alarmMessage.textContent = message;
    },

    injectStyle() {
      if (document.getElementById("dcui-shell-style")) return;

      const style = document.createElement("style");
      style.id = "dcui-shell-style";
      style.textContent = `
        #dcui-shell,
        #dcui-sidebar {
          display: none;
        }
        html.dcui-enabled #top > .dcheader,
        html.dcui-enabled #top > .gnb_bar {
          display: none !important;
        }
        html.dcui-enabled #top.list_wrap,
        html.dcui-enabled #top.view_wrap {
          min-width: var(--dcui-page-width) !important;
        }
        html.dcui-enabled #dcui-shell {
          display: block;
          border-top: 1px solid var(--dcui-color-border-strong);
          background: var(--dcui-color-surface);
          color: var(--dcui-color-text);
          font: 12px/1.4 var(--dcui-font);
        }
        html.dcui-enabled #dcui-shell * {
          box-sizing: border-box;
        }
        html.dcui-enabled #dcui-shell a {
          color: inherit;
          text-decoration: none;
        }
        html.dcui-enabled #dcui-shell .dcui-inner {
          width: var(--dcui-page-width);
          margin: 0 auto;
        }
        html.dcui-enabled #dcui-shell .dcui-utility {
          height: 28px;
          border-bottom: 1px solid var(--dcui-color-border);
          background: var(--dcui-color-subtle);
          color: var(--dcui-color-muted);
        }
        html.dcui-enabled #dcui-shell .dcui-utility .dcui-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 100%;
        }
        html.dcui-enabled #dcui-shell .dcui-utility p {
          margin: 0;
        }
        html.dcui-enabled #dcui-shell .dcui-utility nav {
          display: flex;
          align-items: center;
          gap: 0;
          font: 400 11px/27px var(--dcui-font);
        }
        html.dcui-enabled #dcui-shell .dcui-utility nav > * {
          border: 0;
          padding: 0 8px;
          background: transparent;
          color: var(--dcui-color-muted);
          font: inherit;
          cursor: pointer;
        }
        html.dcui-enabled #dcui-shell .dcui-utility nav > [hidden] {
          display: none !important;
        }
        html.dcui-enabled #dcui-shell .dcui-utility nav > * + * {
          border-left: 1px solid var(--dcui-color-border);
        }
        html.dcui-enabled #dcui-shell .dcui-utility nav > .dcui-theme-toggle-mount {
          display: flex;
          height: 27px;
          align-items: center;
          padding: 0 8px;
          cursor: default;
        }
        html.dcui-enabled #dcui-shell .dcui-utility nav > .dcui-theme-toggle-mount:hover {
          color: inherit;
          text-decoration: none;
        }
        html.dcui-enabled #dcui-shell .dcui-theme-toggle-mount > #dcui-theme-toggle {
          height: 27px;
          font: inherit;
          line-height: 27px;
        }
        html.dcui-enabled #dcui-shell .dcui-theme-toggle-mount > #dcui-theme-toggle .dcui-theme-toggle-label {
          line-height: inherit;
        }
        html.dcui-enabled #dcui-shell .dcui-utility .dcui-native-dark-mode-mount {
          position: relative;
          display: flex;
          align-self: stretch;
          align-items: center;
          padding: 0;
          cursor: default;
        }
        html.dcui-enabled #dcui-shell .dcui-native-dark-mode {
          position: relative;
          float: none;
          display: flex;
          height: 27px;
          margin: 0;
          align-items: center;
        }
        html.dcui-enabled #dcui-shell .dcui-native-dark-mode > .darkonoff {
          display: flex;
          height: 27px;
          align-items: center;
          padding: 0 8px;
          color: var(--dcui-color-muted);
          font: inherit;
          line-height: 27px;
          cursor: pointer;
        }
        html.dcui-enabled #dcui-shell .dcui-native-dark-mode > .darkonoff > .icon_tdark {
          position: relative;
          top: -1px;
          flex: 0 0 auto;
        }
        html.dcui-enabled #dcui-shell .dcui-native-dark-mode > .darkonoff:hover {
          color: var(--dcui-color-link);
          text-decoration: underline;
        }
        html.dcui-enabled #dcui-shell .dcui-utility .dcui-native-alarm-mount {
          position: relative;
          align-self: stretch;
          padding: 0;
        }
        html.dcui-enabled #dcui-shell .dcui-native-alarm-mount > [data-role="nativeAlarm"] {
          height: 27px;
          border: 0;
          padding: 0 8px;
          background: transparent;
          color: var(--dcui-color-muted);
          font: inherit;
          cursor: pointer;
        }
        html.dcui-enabled #dcui-shell [data-role="nativeAlarm"] em {
          display: none;
          width: 4px;
          height: 4px;
          margin: 0 0 7px 3px;
          border-radius: 50%;
          background: #d31900;
        }
        html.dcui-enabled #dcui-shell [data-role="nativeAlarm"] em.dcui-has-native-alarm {
          display: inline-block;
        }
        html.dcui-enabled #dcui-shell .dcui-native-alarm-mount #alarmList,
        html.dcui-enabled #dcui-shell .dcui-native-alarm-mount #alarmConf {
          position: absolute !important;
          z-index: 10030 !important;
          top: calc(100% + 4px) !important;
          right: 0 !important;
          left: auto !important;
          width: 420px;
          margin: 0 !important;
          text-align: left;
        }
        html.dcui-enabled #dcui-shell #alarmConf .notice_setting {
          width: auto;
          color: var(--dcui-color-text);
          background: var(--dcui-color-surface);
        }
        html.dcui-enabled #dcui-shell #alarmConf .inner {
          padding: 12px 14px;
        }
        html.dcui-enabled #dcui-shell #alarmConf .set_element_box {
          padding-right: 65px;
          color: inherit;
        }
        html.dcui-enabled #dcui-shell #alarmConf .inner_txt {
          font-size: 12px;
          white-space: nowrap;
        }
        html.dcui-enabled #dcui-shell #alarmConf .setting_onoff {
          right: 0;
        }
        html.dcui-enabled #dcui-shell #alarmConf .btn_box {
          padding-bottom: 14px;
        }
        html.dcui-enabled #dcui-shell .dcui-utility nav > *:hover {
          color: var(--dcui-color-link);
          text-decoration: underline;
        }
        html.dcui-enabled #dcui-shell .dcui-brand-row {
          position: relative;
          display: flex;
          align-items: center;
          height: 82px;
        }
        html.dcui-enabled #dcui-shell .dcui-brand-slot {
          display: flex;
          min-width: 196px;
          align-items: center;
        }
        html.dcui-enabled #dcui-shell .dcui-brand {
          display: inline-flex;
          align-items: baseline;
          gap: 8px;
          color: var(--dcui-color-nav);
          letter-spacing: -1px;
        }
        html.dcui-enabled #dcui-shell .dcui-brand strong {
          color: var(--dcui-color-nav);
          font-size: 29px;
          font-style: normal;
          font-weight: 900;
          letter-spacing: -2px;
        }
        html.dcui-enabled #dcui-shell .dcui-brand span {
          color: var(--dcui-color-link);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0;
        }
        html.dcui-enabled #dcui-shell .dcui-native-logo {
          position: static !important;
          top: auto !important;
          left: auto !important;
          display: flex !important;
          width: auto !important;
          height: auto !important;
          margin: 0 !important;
          align-items: center;
        }
        html.dcui-enabled #dcui-shell .dcui-native-logo a {
          display: flex !important;
          align-items: center;
        }
        html.dcui-enabled #dcui-shell .dcui-native-logo img {
          position: static !important;
          max-width: none;
        }
        html.dcui-enabled #dcui-shell .dcui-search-slot {
          width: 320px;
          margin-left: auto;
        }
        html.dcui-enabled #dcui-shell #search_wrap {
          position: relative;
          inset: auto !important;
          width: 320px;
          height: 34px;
          margin: 0;
        }
        html.dcui-enabled #dcui-shell #search_wrap fieldset {
          position: relative;
          width: 100%;
          height: 100%;
        }
        html.dcui-enabled #dcui-shell #search_wrap .auto_wordwrap {
          box-sizing: border-box;
          left: 0 !important;
          right: auto !important;
          top: 34px !important;
          width: 100% !important;
          max-width: 100%;
          margin: 0 !important;
          z-index: 20;
        }
        html.dcui-enabled #dcui-shell #search_wrap .auto_wordwrap .word_close {
          border-top: 1px solid var(--dcui-color-border);
          background: var(--dcui-color-surface-muted) !important;
          color: var(--dcui-color-text-soft);
        }
        html.dcui-enabled #dcui-shell #search_wrap .auto_wordwrap .saveonfo .round_label .inr {
          color: var(--dcui-color-nav-light) !important;
        }
        html.dcui-enabled #dcui-shell #search_wrap .top_search {
          width: 320px;
          height: 34px;
          border: 3px solid var(--dcui-color-nav-light);
          background: var(--dcui-color-surface);
        }
        html.dcui-enabled #dcui-shell #search_wrap .inner_search {
          float: left;
          width: 276px;
          height: 28px;
          margin: 0 !important;
        }
        html.dcui-enabled #dcui-shell #search_wrap .in_keyword {
          width: 264px;
          height: 28px;
          color: var(--dcui-color-text);
        }
        html.dcui-enabled #dcui-shell #search_wrap .bnt_search {
          position: relative !important;
          top: 0 !important;
          right: 0 !important;
          float: right !important;
          width: 38px;
          height: 28px;
          margin: 0 !important;
          background-color: var(--dcui-color-nav-light) !important;
          background-image: none !important;
        }
        html.dcui-enabled #dcui-shell #search_wrap .bnt_search::before {
          position: absolute;
          left: 11px;
          top: 5px;
          width: 10px;
          height: 10px;
          border: 2px solid var(--dcui-color-on-accent);
          border-radius: 50%;
          content: "";
        }
        html.dcui-enabled #dcui-shell #search_wrap .bnt_search::after {
          position: absolute;
          left: 22px;
          top: 16px;
          width: 8px;
          height: 2px;
          background: var(--dcui-color-on-accent);
          content: "";
          transform: rotate(45deg);
        }
        html.dcui-enabled #dcui-shell .dcui-nav-bar {
          height: 46px;
          border: 0;
          background: transparent;
          color: var(--dcui-color-on-accent);
        }
        html.dcui-enabled #dcui-shell .dcui-nav-bar nav {
          display: flex;
          box-sizing: border-box;
          width: var(--dcui-page-width);
          align-items: flex-start;
          height: 46px;
          margin: 0 auto;
          padding-left: 12px;
          border-top: 1px solid #3b4890;
          border-bottom: 1px solid #3b4890;
          background: #3b4890;
        }
        html.dcui-enabled #dcui-shell .dcui-gallery-menu {
          position: relative;
          display: flex;
          height: 44px;
        }
        html.dcui-enabled #dcui-shell .dcui-nav-bar a {
          min-width: 0;
          height: 44px;
          margin-left: 20px;
          padding: 0;
          border: 0;
          color: var(--dcui-color-on-accent);
          font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", Arial, Dotum, 돋움, sans-serif;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: .025em;
          line-height: 44px;
          text-align: center;
          text-shadow: 0 -1px #1f2552;
        }
        html.dcui-enabled #dcui-shell .dcui-gallery-menu > a {
          margin-left: 0;
        }
        html.dcui-enabled #dcui-shell .dcui-nav-bar a:hover,
        html.dcui-enabled #dcui-shell .dcui-nav-bar a:focus-visible {
          color: var(--dcui-color-on-accent);
          text-decoration: underline;
        }
        html.dcui-enabled #dcui-shell .dcui-nav-bar a.dcui-active {
          background: transparent;
          color: #ffed44;
        }
        html.dcui-enabled #container > .left_content {
          float: left;
          width: var(--dcui-content-width) !important;
        }
        html.dcui-enabled.dcui-page-view #container > section:first-of-type {
          float: left;
          width: var(--dcui-content-width) !important;
        }
        html.dcui-enabled #container > .right_content {
          float: right;
          width: var(--dcui-sidebar-width) !important;
        }
        html.dcui-enabled #container > .right_content > :not(#dcui-sidebar) {
          display: none !important;
        }
        html.dcui-enabled.dcui-page-view #container > article {
          clear: both;
        }
        html.dcui-enabled #visit_history {
          width: var(--dcui-page-width);
          border-color: var(--dcui-color-border);
          background: var(--dcui-color-subtle);
        }
        html.dcui-enabled #dcui-sidebar {
          display: block;
          width: var(--dcui-sidebar-width);
          color: var(--dcui-color-text);
          font: 12px/1.45 var(--dcui-font);
        }
        html.dcui-enabled #dcui-sidebar * {
          box-sizing: border-box;
        }
        html.dcui-enabled #dcui-sidebar .dcui-side-card {
          margin-bottom: 14px;
          border: 1px solid var(--dcui-color-border);
          background: var(--dcui-color-surface);
        }
        html.dcui-enabled #dcui-sidebar .dcui-side-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 26px;
          padding: 3px 10px;
          border-bottom: 1px solid var(--dcui-color-border);
          background: var(--dcui-color-subtle);
          color: var(--dcui-color-text-soft);
        }
        html.dcui-enabled #dcui-sidebar .dcui-side-title button {
          border: 0;
          padding: 0;
          background: transparent;
          color: var(--dcui-color-muted);
          cursor: pointer;
          font: 11px/1.4 var(--dcui-font);
        }
        html.dcui-enabled #dcui-sidebar .dcui-side-title button:hover {
          color: var(--dcui-color-link);
          text-decoration: underline;
        }
        html.dcui-enabled #dcui-sidebar .dcui-side-title button.dcui-gallery-settings-toggle {
          margin-left: auto;
          color: var(--dcui-color-text-strong);
          text-align: right;
        }
        html.dcui-enabled #dcui-sidebar .dcui-side-title button.dcui-gallery-settings-toggle:hover {
          color: var(--dcui-color-text-strong);
        }
        html.dcui-enabled #dcui-sidebar .dcui-hotkeys > ul {
          display: grid;
          grid-template-columns: 1fr 1fr;
          margin: 0;
          padding: 5px 0 7px;
          list-style: none;
        }
        html.dcui-enabled #dcui-sidebar .dcui-hotkeys.dcui-hotkeys-favorites-pending {
          visibility: hidden;
        }
        html.dcui-enabled #dcui-sidebar .dcui-hotkeys li {
          display: flex;
          min-width: 0;
          align-items: center;
          height: 20px;
          padding: 2px 4px;
        }
        html.dcui-enabled #dcui-sidebar .dcui-hotkeys li:has(
          [data-role="sideGallery"],
          [data-role="sideMinor"],
          [data-role="sideMini"],
          [data-role="sidePerson"]
        ) {
          display: none !important;
        }
        html.dcui-enabled #dcui-sidebar .dcui-hotkeys kbd {
          flex: 0 0 auto;
          min-width: 27px;
          height: 15px;
          margin-right: 4px;
          border: 1px solid var(--dcui-color-border);
          background: var(--dcui-color-surface-strong);
          color: var(--dcui-color-muted);
          font: 700 10px/13px monospace;
          text-align: center;
        }
        html.dcui-enabled #dcui-sidebar .dcui-hotkeys a,
        html.dcui-enabled #dcui-sidebar .dcui-hotkeys li > button {
          min-width: 0;
          overflow: hidden;
          border: 0;
          padding: 0;
          background: transparent;
          color: var(--dcui-color-muted);
          font: 11px/1.4 var(--dcui-font);
          text-decoration: none;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcui-enabled #dcui-sidebar .dcui-hotkeys a:hover,
        html.dcui-enabled #dcui-sidebar .dcui-hotkeys li > button:hover {
          color: var(--dcui-color-link);
          text-decoration: underline;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings {
          position: relative;
          overflow: visible;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-body {
          position: relative;
          padding: 0;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-body[hidden] {
          display: none !important;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-collapsed > .dcui-side-title {
          border-bottom: 0;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle {
          position: relative !important;
          float: none !important;
          width: 100%;
          margin: 0 !important;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-button {
          display: none !important;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle > .new {
          display: none !important;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list {
          position: static !important;
          display: block !important;
          width: 100% !important;
          margin: 0 !important;
          border: 0;
          background: var(--dcui-color-surface);
          box-shadow: none;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list .inner {
          padding: 4px 0;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list ul {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list li {
          min-height: 27px;
          margin: 0;
          border-bottom: 1px solid var(--dcui-color-border);
          padding: 0;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list li:last-child {
          border-bottom: 0;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list li.dcui-custom-setting:has(#dcui-enable-concept-alarm) {
          border-bottom-color: var(--dcui-color-border-strong);
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list li > button,
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list li > span {
          display: flex;
          box-sizing: border-box;
          width: 100%;
          min-height: 27px;
          align-items: center;
          border: 0;
          padding: 5px 9px;
          background: var(--dcui-color-surface);
          color: var(--dcui-color-text-soft);
          font: 11px/17px var(--dcui-font);
          text-align: left;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list li > button:hover {
          background: var(--dcui-color-surface-muted);
          color: var(--dcui-color-link);
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list li > .checkbox:hover {
          background: var(--dcui-color-surface-muted);
          color: var(--dcui-color-link);
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list .checkbox {
          position: relative !important;
          display: flex !important;
          width: 100%;
          min-width: 0;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          overflow: hidden;
          cursor: pointer;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list .checkbox label {
          min-width: 0;
          flex: 1 1 auto;
          overflow: hidden;
          color: inherit;
          text-overflow: ellipsis;
          white-space: nowrap;
          cursor: pointer;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list .checkbox input[type="checkbox"] {
          position: absolute !important;
          width: 1px !important;
          height: 1px !important;
          margin: -1px !important;
          opacity: 0;
          overflow: hidden;
          pointer-events: none;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list .checkbox .checkmark {
          position: relative !important;
          right: auto !important;
          bottom: auto !important;
          display: inline-block;
          flex: 0 0 14px;
          width: 14px !important;
          height: 14px !important;
          margin: 0 !important;
          border: 1px solid var(--dcui-color-border-control) !important;
          border-radius: 2px;
          background: var(--dcui-color-surface) !important;
          background-image: none !important;
          cursor: pointer;
        }
        html.dcui-enabled #dcui-sidebar .dcui-gallery-settings-bundle .setting_list .checkbox input[type="checkbox"]:checked + .checkmark {
          border-color: var(--dcui-color-nav-light) !important;
          background: var(--dcui-color-nav-light) !important;
        }
        html.dcui-enabled #dcui-sidebar [data-role="alarmState"] {
          color: var(--dcui-color-faint);
          font-size: 11px;
          font-weight: 700;
        }
        html.dcui-enabled #dcui-sidebar [data-role="alarmState"].dcui-on {
          color: var(--dcui-color-accent);
        }
        html.dcui-enabled #dcui-sidebar .dcui-alarm-summary p {
          margin: 0;
          padding: 10px 9px 5px;
          overflow: hidden;
          color: var(--dcui-color-text);
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcui-enabled #dcui-sidebar .dcui-alarm-summary small {
          display: block;
          padding: 0 9px 10px;
          color: var(--dcui-color-muted);
        }
        html.dcui-enabled #dcui-sidebar .dcui-side-links {
          margin: 0;
          padding: 5px 9px 8px;
          list-style: none;
        }
        html.dcui-enabled #dcui-sidebar .dcui-side-links li {
          border-bottom: 1px dotted var(--dcui-color-border);
        }
        html.dcui-enabled #dcui-sidebar .dcui-side-links li:last-child {
          border-bottom: 0;
        }
        html.dcui-enabled #dcui-sidebar .dcui-side-links a {
          display: block;
          padding: 6px 2px;
          color: var(--dcui-color-text-soft);
          text-decoration: none;
        }
        html.dcui-enabled #dcui-sidebar .dcui-side-links a:hover {
          color: var(--dcui-color-link);
          text-decoration: underline;
        }
        html.dcui-enabled #dcui-sidebar .dcui-version-card {
          display: flex;
          justify-content: space-between;
          padding: 8px 9px;
          color: var(--dcui-color-muted);
        }
        html.dcui-enabled #visit_history {
          display: none !important;
        }
        html.dcui-enabled #dcui-shell .dcui-brand strong b {
          color: var(--dcui-color-text-soft);
        }
        html.dcui-enabled #dcui-shell .dcui-brand strong em {
          color: var(--dcui-color-link-secondary);
          font-style: normal;
        }
        html.dcui-enabled #dcui-shell .dcui-brand span {
          color: var(--dcui-color-muted);
          font-size: 12px;
        }
        html.dcui-enabled #dcui-shell .dcui-search-slot,
        html.dcui-enabled #dcui-shell #search_wrap,
        html.dcui-enabled #dcui-shell #search_wrap .top_search {
          width: 255px;
        }
        html.dcui-enabled #dcui-shell #search_wrap .top_search {
          display: flex;
          align-items: center;
          border: 0;
        }
        html.dcui-enabled #dcui-shell #search_wrap .inner_search {
          box-sizing: border-box;
          width: 211px;
          height: 30px;
          border: 3px solid var(--dcui-color-nav-light);
        }
        html.dcui-enabled #dcui-shell #search_wrap .in_keyword {
          box-sizing: border-box;
          width: 205px;
          height: 24px;
        }
        html.dcui-enabled #dcui-shell #search_wrap .bnt_search {
          width: 39px;
          height: 28px;
          margin-left: 5px !important;
          border: 1px solid var(--dcui-color-border-strong) !important;
          border-radius: 3px;
          background: linear-gradient(to bottom, var(--dcui-color-control-gradient-top) 0, var(--dcui-color-control-gradient-bottom) 100%) !important;
          color: var(--dcui-color-text-soft);
          font-size: 0;
        }
        html.dcui-enabled #dcui-shell #search_wrap .bnt_search::before {
          position: static;
          display: block;
          width: auto;
          height: auto;
          border: 0;
          border-radius: 0;
          color: var(--dcui-color-text-soft);
          font: 12px/26px var(--dcui-font);
          content: "검색";
        }
        html.dcui-enabled #dcui-shell #search_wrap .bnt_search::after {
          display: none;
        }
        html.dcui-enabled #dcui-shell .dcui-nav-spacer {
          flex: 1;
        }
        html.dcui-enabled #dcui-shell .dcui-nav-bar a[data-role="allBoards"],
        html.dcui-enabled #dcui-shell .dcui-nav-bar a[data-role="favorites"] {
          min-width: 0;
          padding-left: 11px;
          padding-right: 11px;
          border-right: 0;
        }
      `;
      document.documentElement.appendChild(style);
    },
  });

  let settingsModalState = null;
  let settingsModalTimers = [];
  let settingsModalLastTrigger = null;
  let settingsModalArmObserver = null;
  let settingsModalPointerCloseTrigger = null;
  let settingsUserMemoOpen = false;
  const SettingsModalView = Object.freeze({
    mount(card) {
      if (!card || document.getElementById("dcui-settings-modal")) return;

      const overlay = document.createElement("div");
      overlay.id = "dcui-settings-modal";
      overlay.hidden = true;
      overlay.innerHTML = '<section class="dcui-settings-modal-dialog" role="dialog" aria-modal="false" aria-labelledby="dcui-settings-modal-title" data-placement="right"><header><strong id="dcui-settings-modal-title">설정</strong><button type="button" class="dcui-settings-modal-close" aria-label="설정 패널 닫기">×</button></header><div class="dcui-settings-modal-host"></div></section>';
      document.body.appendChild(overlay);

      card.addEventListener("pointerdown", (event) => {
        const button = event.target.closest(".setting_list li:not(.dcui-custom-setting) button");
        if (!button) return;
        const selector = this.selectorFor(this.labelForButton(button));
        const visibleKnownPanel = selector
          ? [...document.querySelectorAll(selector)].some((node) => this.isVisible(node))
          : false;
        const stateMatches = Boolean(settingsModalState?.primary?.matches(selector || ":not(*)"));
        settingsModalPointerCloseTrigger = (!overlay.hidden && (settingsModalLastTrigger === button || stateMatches))
          || visibleKnownPanel
          ? button
          : null;
      }, true);

      card.addEventListener("click", (event) => {
        const button = event.target.closest(".setting_list li:not(.dcui-custom-setting) button");
        if (!button) return;
        const item = button.closest("li");
        const label = this.labelForButton(button);
        const panelSelector = this.selectorFor(label);
        if (button.id === "btn_user_memo_set") {
          event.preventDefault();
          event.stopImmediatePropagation();
          const visibleMemoPanel = [...document.querySelectorAll("#user_memo_config")]
            .some((node) => this.isVisible(node));
          if (settingsUserMemoOpen || visibleMemoPanel || settingsModalPointerCloseTrigger === button) {
            settingsUserMemoOpen = false;
            settingsModalPointerCloseTrigger = null;
            this.close();
            return;
          }

          settingsModalPointerCloseTrigger = null;
          settingsUserMemoOpen = true;
          document.querySelectorAll("#user_memo_config").forEach((node) => node.remove());
          ShellView.ensureNativeSettingsAnchor();
          this.arm(label, button);
          if (!this.runNativeInline(button)) {
            settingsUserMemoOpen = false;
            this.showLoadFailure(label);
          }
          return;
        }
        const sameOpenPanel = Boolean(
          settingsModalState?.primary
          && panelSelector
          && settingsModalState.primary.matches(panelSelector),
        );
        const visibleKnownPanel = panelSelector
          ? [...document.querySelectorAll(panelSelector)].some((node) => this.isVisible(node))
          : false;
        const sameTrigger = settingsModalLastTrigger === button
          || item?.classList.contains("dcui-settings-trigger-active")
          || sameOpenPanel
          || settingsModalPointerCloseTrigger === button;
        settingsModalPointerCloseTrigger = null;
        if ((!overlay.hidden && sameTrigger) || visibleKnownPanel) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.close();
          return;
        }
        if (!overlay.hidden && settingsModalLastTrigger && settingsModalLastTrigger !== button) {
          // Close the previous native layer before the next row's inline handler runs.
          // Closing later from the bubble-phase arm() can accidentally consume the
          // newly-created layer when moving quickly between different settings.
          this.close();
        }

        const nativeLayerSelector = button.id === "btn_user_memo_set"
          ? "#user_memo_config"
          : (button.id === "btn_trusted_site_set" ? "#trusted_site_config" : "");
        if (!nativeLayerSelector) return;
        document.querySelectorAll(nativeLayerSelector).forEach((node) => node.remove());
        ShellView.ensureNativeSettingsAnchor();
        // The original inline handler must run in DCInside's page context.
        // UserMemo/TrustedSite are not exposed to Tampermonkey's isolated world.
      }, true);

      card.addEventListener("click", (event) => {
        const button = event.target.closest(".setting_list li:not(.dcui-custom-setting) button");
        if (!button) return;
        this.arm(this.labelForButton(button), button);
      });
      card.addEventListener("click", (event) => {
        const checkbox = event.target.closest(".setting_list li .checkbox");
        if (!checkbox || event.target.closest("input, label")) return;
        const input = checkbox.querySelector('input[type="checkbox"]');
        if (!input || input.disabled) return;
        event.preventDefault();
        input.click();
      });
      overlay.querySelector(".dcui-settings-modal-close")?.addEventListener("click", () => this.close());
      overlay.addEventListener("click", (event) => {
        const checkboxControl = event.target.closest("#user_memo_table input[type='checkbox'], #user_memo_table .checkmark");
        const checkbox = checkboxControl?.closest(".checkbox");
        const input = checkbox?.querySelector('input[type="checkbox"]');
        if (!checkboxControl || !checkbox || !input || input.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        input.checked = !input.checked;
        const table = checkbox.closest("#user_memo_table");
        const rowInputs = [...table.querySelectorAll(".memo_list .chk_um_list")];
        const isSelectAll = input.id === "chk_all_um_list"
          || Boolean(checkbox.closest(".cont_tit"));
        if (isSelectAll) rowInputs.forEach((rowInput) => { rowInput.checked = input.checked; });
        else {
          const allInput = table.querySelector("#chk_all_um_list, .cont_tit .checkbox input[type='checkbox']");
          if (allInput) allInput.checked = rowInputs.length > 0 && rowInputs.every((rowInput) => rowInput.checked);
        }
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, true);
      overlay.addEventListener("click", (event) => {
        const memoRow = event.target.closest("#user_memo_table .memo_list .btn-wrap > button");
        const host = overlay.querySelector(".dcui-settings-modal-host");
        const memoList = memoRow?.closest(".memo_list");
        if (!memoRow || !host || !memoList || !settingsModalState) return;
        if (event.target.closest("label") && !event.target.closest("input[type='checkbox'], .checkmark")) {
          event.preventDefault();
        }
        const hostScrollTop = host.scrollTop;
        const memoScrollTop = memoList.scrollTop;
        const restoreScroll = () => {
          if (overlay.hidden || !settingsModalState) return;
          host.scrollTop = hostScrollTop;
          const currentMemoList = overlay.querySelector("#user_memo_table .memo_list");
          if (currentMemoList) currentMemoList.scrollTop = memoScrollTop;
        };
        [0, 50, 150, 350].forEach((delay) => window.setTimeout(restoreScroll, delay));
      }, true);
      overlay.addEventListener("click", (event) => {
        const closeButton = event.target.closest(".poply_whiteclose, .poply_bgblueclose, .poply_greyclose, .poply_bgclose, .poply_close, .btn_close");
        if (closeButton) {
          const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
          const closesAuxiliary = eventPath.some((node) => node instanceof Element
            && (node.classList.contains("dcui-native-settings-auxiliary")
              || node.classList.contains("dcui-native-settings-nested")));
          if (closesAuxiliary) {
            window.setTimeout(() => {
              if (!overlay.hidden && settingsModalState) this.positionPanel();
            }, 0);
            return;
          }
          if (settingsModalState?.closing) return;
          window.setTimeout(() => this.close({ callNative: false }), 0);
        }
      });
      const closeSettingsOnOutside = (event) => {
        if (overlay.hidden || !settingsModalState) return;
        if (event.target.closest("#dcui-settings-modal .dcui-settings-modal-dialog")) return;
        if (event.target.closest("#dcui-sidebar .dcui-gallery-settings")) return;
        this.close();
      };
      document.addEventListener("pointerdown", closeSettingsOnOutside, true);
      document.addEventListener("click", closeSettingsOnOutside, true);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !overlay.hidden) this.close();
      });
      const reposition = () => {
        if (!overlay.hidden && settingsModalState) {
          this.positionPanel();
          this.fitControlText(settingsModalState.primary);
        }
      };
      window.addEventListener("resize", reposition, { passive: true });
      window.addEventListener("scroll", reposition, { passive: true });
      this.injectStyle();
    },

    labelForButton(button) {
      const item = button?.closest("li");
      const labelCopy = (item?.querySelector("label") || button)?.cloneNode(true);
      labelCopy?.querySelectorAll(".new, .blind, script").forEach((node) => node.remove());
      return cleanText(labelCopy?.textContent || button?.textContent || item?.textContent);
    },

    runNativeInline(button) {
      const inlineHandler = button?.getAttribute("onclick");
      if (!inlineHandler) return false;
      const runner = document.createElement("button");
      runner.type = "button";
      runner.hidden = true;
      runner.tabIndex = -1;
      runner.setAttribute("aria-hidden", "true");
      runner.setAttribute("onclick", inlineHandler);
      document.body.appendChild(runner);
      try {
        runner.click();
        return true;
      } finally {
        runner.remove();
      }
    },

    arm(label, trigger) {
      if (settingsModalState) this.close();
      settingsModalLastTrigger = trigger || document.activeElement;
      document.querySelectorAll(".dcui-settings-trigger-active")
        .forEach((node) => node.classList.remove("dcui-settings-trigger-active"));
      settingsModalLastTrigger?.closest("li")?.classList.add("dcui-settings-trigger-active");
      this.showPending(label);
      settingsModalTimers.forEach((timer) => window.clearTimeout(timer));
      settingsModalArmObserver?.disconnect();
      settingsModalArmObserver = null;
      const capture = () => {
        const source = this.findPopup(label);
        if (!source) return false;
        settingsModalArmObserver?.disconnect();
        settingsModalArmObserver = null;
        this.open(source, label);
        return true;
      };
      settingsModalTimers = [0, 40, 120, 300, 700, 1400, 2600, 5000, 9000]
        .map((delay) => window.setTimeout(capture, delay));
      if (typeof MutationObserver === "function") {
        settingsModalArmObserver = new MutationObserver(capture);
        settingsModalArmObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style", "hidden"],
        });
        settingsModalTimers.push(window.setTimeout(() => {
          settingsModalArmObserver?.disconnect();
          settingsModalArmObserver = null;
        }, 10000));
      }
      settingsModalTimers.push(window.setTimeout(() => this.showLoadFailure(label), 10000));
    },

    showPending(label) {
      const overlay = document.getElementById("dcui-settings-modal");
      const host = overlay?.querySelector(".dcui-settings-modal-host");
      if (!overlay || !host) return;
      overlay.querySelector("#dcui-settings-modal-title").textContent = label || "설정";
      overlay.querySelector(".dcui-settings-modal-dialog").dataset.source = "";
      host.innerHTML = '<div class="dcui-settings-loading" role="status">설정을 불러오는 중입니다.</div>';
      overlay.hidden = false;
      this.positionPanel();
    },

    showLoadFailure(label) {
      if (settingsModalState) return;
      const overlay = document.getElementById("dcui-settings-modal");
      const host = overlay?.querySelector(".dcui-settings-modal-host");
      if (!overlay || overlay.hidden || !host) return;
      overlay.querySelector("#dcui-settings-modal-title").textContent = label || "설정";
      host.innerHTML = '<div class="dcui-settings-loading dcui-settings-load-failed">설정 데이터를 불러오지 못했습니다.<small>로그인 상태나 네트워크 연결을 확인한 뒤 다시 눌러 주세요.</small></div>';
      if (label.includes("이용자 메모")) settingsUserMemoOpen = false;
    },

    selectorFor(label) {
      if (label.includes("이용자 메모")) return "#user_memo_config";
      if (label.includes("차단 설정")) return "#user_block";
      if (label.includes("자동 짤방")) return "#autozzal_setting_pop";
      if (label.includes("머리말") || label.includes("꼬리말")) return "#headTail_lay";
      if (label.includes("스포일러")) return "#spoiler_set_lyr";
      if (label.includes("신뢰할 수 있는 사이트")) {
        return "#trusted_site_config, #trusted_site_set_lyr, #trusted_site_lyr, #trusted_site_pop, .trusted_site_wrap";
      }
      return "";
    },

    normalizePopup(node) {
      if (!node) return null;
      return node.matches(".pop_wrap") ? node : (node.closest(".pop_wrap") || node);
    },

    knownPopup(label) {
      const selector = this.selectorFor(label);
      const explicit = selector ? document.querySelector(selector) : null;
      if (explicit) return this.normalizePopup(explicit);
      if (label.includes("이용자 메모")) {
        return this.normalizePopup(document.querySelector("#user_memo_setting, #user_memo_table"));
      }
      if (label.includes("신뢰할 수 있는 사이트")) {
        return this.normalizePopup(document.querySelector("#trusted_site_table"));
      }
      return null;
    },

    isVisible(node) {
      if (!node || node.hidden) return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },

    popupCandidates() {
      return [...document.querySelectorAll(".pop_wrap")].filter((node) => {
        if (node.closest("#dcui-sidebar, #dcui-settings-modal, #alarmList, #alarmConf")) return false;
        if (["relation_popup", "visit_history_lyr", "my_favorite"].includes(node.id)) return false;
        return this.isVisible(node);
      });
    },

    findPopup(label) {
      return this.knownPopup(label) || this.popupCandidates()[0] || null;
    },

    open(source, label) {
      const overlay = document.getElementById("dcui-settings-modal");
      const host = overlay?.querySelector(".dcui-settings-modal-host");
      if (!overlay || !host || !source) return;
      if (settingsModalState?.primary === source && host.contains(source)) {
        this.moveAuxiliaryLayers();
        overlay.hidden = false;
        return;
      }

      if (settingsModalState) this.close({ callNative: false });
      host.replaceChildren();
      settingsModalState = { primary: source, entries: [], observer: null, closing: false };
      const nativeTitle = cleanText(source.querySelector(".pop_head h3, .pop_head strong")?.textContent);
      overlay.querySelector("#dcui-settings-modal-title").textContent = nativeTitle || label || "설정";
      overlay.querySelector(".dcui-settings-modal-dialog").dataset.source = source.id || "";
      this.moveLayer(source, false);
      overlay.hidden = false;
      this.positionPanel();
      this.moveAuxiliaryLayers();
      window.requestAnimationFrame(() => this.positionPanel());

      const observer = new MutationObserver(() => {
        if (!settingsModalState || settingsModalState.closing) return;
        window.requestAnimationFrame(() => {
          if (!settingsModalState || settingsModalState.closing) return;
          if (!this.isVisible(settingsModalState.primary)) {
            this.close({ callNative: false });
            return;
          }
          this.moveAuxiliaryLayers();
        });
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden"],
      });
      settingsModalState.observer = observer;
    },

    positionPanel() {
      const overlay = document.getElementById("dcui-settings-modal");
      const dialog = overlay?.querySelector(".dcui-settings-modal-dialog");
      const trigger = settingsModalLastTrigger;
      if (!dialog || !trigger?.isConnected) return;
      const anchor = trigger.closest("li") || trigger;
      const card = trigger.closest(".dcui-gallery-settings") || trigger.closest("#dcui-sidebar") || anchor;
      const anchorRect = anchor.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const edge = 12;
      const gap = 8;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const sourceId = settingsModalState?.primary?.id || "";
      const compactPanel = /trusted|spoiler/i.test(sourceId);
      const preferredWidth = compactPanel ? 360 : 400;
      const targetWidth = Math.min(preferredWidth, Math.max(0, viewportWidth - edge * 2));
      const adjacentLeft = Math.round(cardRect.right + gap);
      const availableRight = viewportWidth - adjacentLeft - edge;
      const adjacentFits = availableRight >= targetWidth;
      const width = targetWidth;
      const constrained = !adjacentFits;
      const left = constrained
        ? Math.max(edge, viewportWidth - width - edge)
        : adjacentLeft;
      const top = Math.max(edge, Math.min(Math.round(anchorRect.top), viewportHeight - 150));
      dialog.dataset.constrained = constrained ? "true" : "false";
      dialog.style.left = `${left}px`;
      dialog.style.top = `${top}px`;
      dialog.style.width = `${width}px`;
      dialog.style.maxHeight = `${Math.max(138, viewportHeight - top - edge)}px`;
    },

    moveLayer(node, auxiliary) {
      const host = document.querySelector("#dcui-settings-modal .dcui-settings-modal-host");
      if (!host || !node || settingsModalState?.entries.some((entry) => entry.node === node)) return;
      settingsModalState.entries.push({
        node,
        parent: node.parentNode,
        nextSibling: node.nextSibling,
        style: node.getAttribute("style"),
      });
      node.classList.add("dcui-native-settings-layer");
      node.classList.toggle("dcui-native-settings-auxiliary", auxiliary);
      node.style.display = "block";
      node.style.position = "static";
      node.style.inset = "auto";
      node.style.width = "100%";
      node.style.maxWidth = "100%";
      node.style.height = "auto";
      node.style.margin = auxiliary ? "10px 0 0" : "0";
      node.style.transform = "none";
      host.appendChild(node);
    },

    moveAuxiliaryLayers() {
      const primary = settingsModalState?.primary;
      if (!primary) return;
      if (primary.id === "user_memo_config" || primary.querySelector("#user_memo_table")) {
        primary.querySelectorAll("#user_memo_table .memo_list .btn-wrap > button")
          .forEach((button) => {
            button.title = "메모 수정";
            button.setAttribute("aria-label", `${cleanText(button.textContent)} 메모 수정`);
          });
      }
      for (const node of this.popupCandidates()) {
        if (node === primary || primary.contains(node)) continue;
        this.moveLayer(node, true);
      }
      for (const node of primary.querySelectorAll(".pop_wrap")) {
        if (!this.isVisible(node)) continue;
        node.classList.add("dcui-native-settings-nested");
      }
      this.fitControlText(primary);
      window.requestAnimationFrame(() => this.fitControlText(primary));
    },

    fitControlText(scope) {
      if (!scope?.isConnected) return;
      const selector = [
        ".tab_menubox > button",
        ".block_tab > button",
        ".btn_tabbox > button",
        ".btn_txtbox > button",
        ".btn_box > button",
        ".select_area",
        ".intbox > button",
        ".set_cont > .btn_enroll",
        ".radiobox > label",
        ".cont_tit",
      ].join(",");
      scope.querySelectorAll(selector).forEach((node) => {
        if (!this.isVisible(node) || node.closest(".memo_list")) return;
        const computed = getComputedStyle(node);
        const computedSize = Number.parseFloat(computed.fontSize);
        const measuredBase = node.dataset.dcuiFitBaseFont
          ? Number.parseFloat(node.dataset.dcuiFitBaseFont)
          : Math.min(computedSize, 9);
        if (!Number.isFinite(measuredBase) || measuredBase <= 0) return;
        if (!node.dataset.dcuiFitBaseFont) node.dataset.dcuiFitBaseFont = String(measuredBase);
        const minimum = Math.min(measuredBase, 7.5);
        let size = measuredBase;
        node.style.setProperty("white-space", "nowrap", "important");
        node.style.setProperty("font-size", `${size}px`, "important");
        while (size > minimum && node.scrollWidth > node.clientWidth + 1) {
          size = Math.max(minimum, size - 0.25);
          node.style.setProperty("font-size", `${size}px`, "important");
        }
        if (node.scrollWidth > node.clientWidth + 1 && !node.title) {
          const label = cleanText(node.textContent);
          if (label) node.title = label;
        }
      });
    },

    close(options = {}) {
      settingsModalTimers.forEach((timer) => window.clearTimeout(timer));
      settingsModalTimers = [];
      settingsModalArmObserver?.disconnect();
      settingsModalArmObserver = null;
      const overlay = document.getElementById("dcui-settings-modal");
      const state = settingsModalState;
      const closingUserMemo = settingsUserMemoOpen
        || settingsModalLastTrigger?.id === "btn_user_memo_set"
        || state?.primary?.matches?.("#user_memo_config");
      if (closingUserMemo) settingsUserMemoOpen = false;
      if (!state) {
        if (overlay) overlay.hidden = true;
        overlay?.querySelector(".dcui-settings-modal-host")?.replaceChildren();
        document.querySelectorAll(".dcui-settings-trigger-active")
          .forEach((node) => node.classList.remove("dcui-settings-trigger-active"));
        if (settingsModalLastTrigger?.isConnected) settingsModalLastTrigger.focus({ preventScroll: true });
        settingsModalLastTrigger = null;
        return;
      }
      state.closing = true;
      state.observer?.disconnect();

      if (options.callNative !== false) {
        const closeButton = state.primary.querySelector(".poply_whiteclose, .poply_bgblueclose, .poply_greyclose, .poply_bgclose, .poply_close, .btn_close");
        try {
          closeButton?.click();
        } catch (_error) {
          // The restored layer is hidden below even if the native close handler fails.
        }
      }

      for (const entry of [...state.entries].reverse()) {
        const { node, parent, nextSibling, style } = entry;
        node.classList.remove("dcui-native-settings-layer", "dcui-native-settings-auxiliary");
        node.querySelectorAll(".dcui-native-settings-nested")
          .forEach((nested) => nested.classList.remove("dcui-native-settings-nested"));
        if (style == null) node.removeAttribute("style");
        else node.setAttribute("style", style);
        if (!node.isConnected) continue;
        if (parent?.isConnected) parent.insertBefore(node, nextSibling?.isConnected ? nextSibling : null);
        else document.body.appendChild(node);
        node.style.display = "none";
      }
      overlay.hidden = true;
      overlay.querySelector(".dcui-settings-modal-host")?.replaceChildren();
      settingsModalState = null;
      document.querySelectorAll(".dcui-settings-trigger-active")
        .forEach((node) => node.classList.remove("dcui-settings-trigger-active"));
      if (settingsModalLastTrigger?.isConnected) settingsModalLastTrigger.focus({ preventScroll: true });
      settingsModalLastTrigger = null;
    },

    injectStyle() {
      if (document.getElementById("dcui-settings-modal-style")) return;
      const style = document.createElement("style");
      style.id = "dcui-settings-modal-style";
      style.textContent = `
        #dcui-settings-modal {
          position: fixed;
          z-index: 12000;
          inset: 0;
          box-sizing: border-box;
          background: transparent;
          font-family: var(--dcui-font);
          pointer-events: none;
        }
        .dcui-native-settings-anchor {
          display: contents;
        }
        .dcui-native-settings-anchor > .gall_issuebox {
          display: none !important;
        }
        #dcui-settings-modal[hidden] {
          display: none;
        }
        #dcui-settings-modal .dcui-settings-modal-dialog {
          position: fixed;
          display: grid;
          grid-template-rows: 28px minmax(0, 1fr);
          box-sizing: border-box;
          border: 1px solid var(--dcui-color-border-strong);
          border-top: 2px solid var(--dcui-color-nav-light);
          border-radius: 0;
          background: var(--dcui-color-surface);
          box-shadow: 0 3px 12px rgba(28, 32, 52, 0.18);
          overflow: hidden;
          pointer-events: auto;
          font: 8px/1.25 var(--dcui-font);
        }
        #dcui-settings-modal .dcui-settings-modal-dialog > header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 6px 0 8px;
          border-bottom: 1px solid var(--dcui-color-border-strong);
          background: var(--dcui-color-surface-muted);
          color: var(--dcui-color-nav);
          font-size: 10px;
        }
        #dcui-settings-modal .dcui-settings-modal-close {
          width: 20px;
          height: 20px;
          border: 0;
          padding: 0;
          background: transparent;
          color: var(--dcui-color-muted);
          font: 16px/20px Arial, sans-serif;
          cursor: pointer;
        }
        #dcui-settings-modal .dcui-settings-modal-close:hover {
          color: var(--dcui-color-link);
        }
        #dcui-settings-modal .dcui-settings-modal-dialog[data-source="user_memo_config"] .dcui-settings-modal-close {
          display: none !important;
        }
        #dcui-settings-modal #user_memo_config > .pop_content > .poply_whiteclose {
          display: none !important;
        }
        #dcui-settings-modal .dcui-settings-modal-host {
          min-height: 0;
          overflow: auto;
          padding: 4px;
          background: var(--dcui-color-surface);
        }
        #dcui-settings-modal .dcui-settings-loading {
          min-height: 54px;
          box-sizing: border-box;
          padding: 13px 9px;
          border: 1px solid var(--dcui-color-border-soft);
          background: var(--dcui-color-surface-notice);
          color: var(--dcui-color-muted);
          font-size: 9px;
          text-align: center;
        }
        #dcui-settings-modal .dcui-settings-loading small {
          display: block;
          margin-top: 4px;
          color: var(--dcui-color-faint);
          font-size: 8px;
        }
        #dcui-settings-modal .dcui-native-settings-layer,
        #dcui-settings-modal .dcui-native-settings-layer > .pop_content {
          box-sizing: border-box;
          max-width: 100%;
        }
        #dcui-settings-modal .dcui-native-settings-layer {
          min-width: 0 !important;
          border: 0 !important;
          background: transparent !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer > .pop_content,
        #dcui-settings-modal .dcui-native-settings-layer.pop_content {
          position: static !important;
          width: 100% !important;
          min-width: 0 !important;
          height: auto !important;
          margin: 0 !important;
          border: 1px solid var(--dcui-color-border-strong) !important;
          background: var(--dcui-color-surface) !important;
          color: var(--dcui-color-text-soft);
          font: 8px/1.25 var(--dcui-font) !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer > .pop_content > .pop_head:first-child,
        #dcui-settings-modal .dcui-native-settings-layer > .poply_whiteclose,
        #dcui-settings-modal .dcui-native-settings-layer > .poply_bgblueclose,
        #dcui-settings-modal .dcui-native-settings-layer > .poply_greyclose,
        #dcui-settings-modal .dcui-native-settings-layer > .poply_bgclose,
        #dcui-settings-modal .dcui-native-settings-layer > .poply_close,
        #dcui-settings-modal .dcui-native-settings-layer > .pop_content > .poply_whiteclose,
        #dcui-settings-modal .dcui-native-settings-layer > .pop_content > .poply_bgblueclose,
        #dcui-settings-modal .dcui-native-settings-layer > .pop_content > .poply_greyclose,
        #dcui-settings-modal .dcui-native-settings-layer > .pop_content > .poply_bgclose,
        #dcui-settings-modal .dcui-native-settings-layer > .pop_content > .poply_close {
          display: none !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .inner {
          box-sizing: border-box;
          max-width: 100%;
        }
        #dcui-settings-modal .dcui-native-settings-layer > .pop_content > .inner,
        #dcui-settings-modal .dcui-native-settings-layer.pop_content > .inner {
          width: 100% !important;
          padding: 5px 6px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer button,
        #dcui-settings-modal .dcui-native-settings-layer input,
        #dcui-settings-modal .dcui-native-settings-layer textarea,
        #dcui-settings-modal .dcui-native-settings-layer select {
          font-family: var(--dcui-font) !important;
          font-size: 8px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer p,
        #dcui-settings-modal .dcui-native-settings-layer h4,
        #dcui-settings-modal .dcui-native-settings-layer label,
        #dcui-settings-modal .dcui-native-settings-layer li,
        #dcui-settings-modal .dcui-native-settings-layer a {
          font-size: 8px !important;
          line-height: 1.25 !important;
          word-break: keep-all;
          overflow-wrap: break-word;
        }
        #dcui-settings-modal .dcui-native-settings-layer .cont_tit {
          font-size: 8px !important;
          line-height: 1.25 !important;
          white-space: nowrap;
        }
        #dcui-settings-modal .dcui-native-settings-layer .tabcontent,
        #dcui-settings-modal .dcui-native-settings-layer .tabbox,
        #dcui-settings-modal .dcui-native-settings-layer .set_cont,
        #dcui-settings-modal .dcui-native-settings-layer .scrollarea,
        #dcui-settings-modal .dcui-native-settings-layer .textarea_box,
        #dcui-settings-modal .dcui-native-settings-layer .sch_box {
          box-sizing: border-box;
          max-width: 100%;
        }
        #dcui-settings-modal .dcui-native-settings-layer textarea,
        #dcui-settings-modal .dcui-native-settings-layer input[type="text"] {
          box-sizing: border-box;
          max-width: 100%;
        }
        #dcui-settings-modal .dcui-native-settings-layer input[type="text"],
        #dcui-settings-modal .dcui-native-settings-layer select {
          height: 22px !important;
          min-height: 22px !important;
          padding: 2px 4px !important;
          line-height: 16px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox {
          display: flex;
          box-sizing: border-box !important;
          width: 100% !important;
          height: 23px !important;
          min-height: 23px !important;
          margin: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          border-bottom: 1px solid var(--dcui-color-nav-light) !important;
          background: var(--dcui-color-surface-muted) !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox button {
          display: flex !important;
          box-sizing: border-box !important;
          min-width: 0;
          width: auto !important;
          height: 23px !important;
          min-height: 23px !important;
          flex: 1 1 0;
          align-items: center;
          justify-content: center;
          margin: 0 !important;
          border: 0 !important;
          border-right: 1px solid var(--dcui-color-border-strong) !important;
          padding: 0 5px !important;
          background: var(--dcui-color-surface-muted) !important;
          color: var(--dcui-color-text-soft) !important;
          font: 8px/21px var(--dcui-font) !important;
          cursor: pointer;
        }
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox button:last-child {
          border-right: 0 !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox button.on {
          position: relative;
          height: 23px !important;
          margin-bottom: 0 !important;
          border: 1px solid var(--dcui-color-nav-light) !important;
          border-bottom-color: var(--dcui-color-on-accent) !important;
          background: var(--dcui-color-surface) !important;
          color: var(--dcui-color-link) !important;
          font-weight: 700 !important;
          z-index: 1;
        }
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox button p {
          display: block !important;
          margin: 0 !important;
          padding: 0 !important;
          font: inherit !important;
          white-space: nowrap !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox button .gallname,
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox button p.gallname {
          display: none !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox + .inner {
          margin: 0 !important;
          padding: 4px 6px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox + .inner > .tabcontent,
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox + .inner > .tabcontent > .tabbox {
          margin-top: 0 !important;
          padding-top: 0 !important;
        }
        #dcui-settings-modal #user_memo_setting > .tabbox,
        #dcui-settings-modal #user_memo_cont,
        #dcui-settings-modal #autozzal_setting_pop .tabcontent,
        #dcui-settings-modal #headTail_lay .tabcontent {
          margin-top: 0 !important;
          padding-top: 0 !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .btn_box {
          box-sizing: border-box;
          max-width: 100%;
        }
        #dcui-settings-modal .dcui-native-settings-layer .btn_box > button {
          min-width: 44px !important;
          height: 22px !important;
          padding: 0 7px !important;
          line-height: 20px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer > .pop_content > .btn_box,
        #dcui-settings-modal .dcui-native-settings-layer.pop_content > .btn_box {
          position: static !important;
          display: flex !important;
          box-sizing: border-box !important;
          width: 100% !important;
          min-height: 30px !important;
          height: 30px !important;
          align-items: center;
          justify-content: center;
          gap: 4px;
          margin: 0 !important;
          padding: 4px 6px !important;
          border-top: 1px solid var(--dcui-color-border-strong);
        }
        #dcui-settings-modal .dcui-native-settings-layer .pop_info {
          box-sizing: border-box;
          min-height: 0 !important;
          padding: 5px 6px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .pop_bg {
          display: none !important;
        }
        #dcui-settings-modal #user_memo_config .umome_wrap,
        #dcui-settings-modal #user_memo_setting,
        #dcui-settings-modal #user_memo_setting > .tabbox,
        #dcui-settings-modal #user_memo_cont,
        #dcui-settings-modal #user_memo_table,
        #dcui-settings-modal #user_memo_search {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
        #dcui-settings-modal #user_memo_cont > .inr,
        #dcui-settings-modal #user_memo_table > .inr.flex {
          display: flex !important;
          width: 100% !important;
          align-items: center;
          gap: 5px;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }
        #dcui-settings-modal #user_memo_cont .cont_tit,
        #dcui-settings-modal #user_memo_table .cont_tit {
          min-width: 0;
          margin: 0 !important;
          font-size: 8px !important;
        }
        #dcui-settings-modal #user_memo_cont .textarea_box,
        #dcui-settings-modal #user_memo_cont textarea {
          width: 100% !important;
        }
        #dcui-settings-modal #user_memo_cont textarea {
          min-height: 44px !important;
          padding: 4px !important;
          line-height: 1.3 !important;
          resize: vertical;
        }
        #dcui-settings-modal #user_memo_cont .info_txt {
          margin-top: 5px !important;
          font-size: 8px !important;
          word-break: keep-all;
        }
        #dcui-settings-modal #user_memo_cont .info_txt p {
          margin: 1px 0 !important;
        }
        #dcui-settings-modal #user_memo_table > .inr.flex {
          flex-wrap: wrap;
        }
        #dcui-settings-modal #user_memo_table .btn_tabbox {
          margin-left: auto;
          white-space: nowrap;
        }
        #dcui-settings-modal #user_memo_table .btn_txtbox {
          white-space: nowrap;
        }
        #dcui-settings-modal #user_memo_table .btn_txtbox.copydel > button {
          box-sizing: border-box !important;
          min-height: 22px !important;
          height: 22px !important;
          margin: 0 !important;
          padding: 0 6px !important;
          border: 1px solid var(--dcui-color-border-strong) !important;
          line-height: 20px !important;
        }
        #dcui-settings-modal #user_memo_table .memo_list {
          box-sizing: border-box;
          width: 100% !important;
          max-width: 100% !important;
          max-height: 125px;
          margin: 0 !important;
          padding: 0 !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
        }
        #dcui-settings-modal #user_memo_table .memo_list li {
          position: relative !important;
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          min-height: 18px !important;
          height: 18px !important;
          margin: 0 !important;
          padding: 0 !important;
          list-style: none !important;
        }
        #dcui-settings-modal #user_memo_table .memo_list li::after {
          top: 50vh !important;
          bottom: auto !important;
        }
        #dcui-settings-modal #user_memo_table .memo_list .btn-wrap,
        #dcui-settings-modal #user_memo_table .memo_list .btn-wrap > .btn {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          min-height: 18px !important;
          height: 18px !important;
          margin: 0 !important;
          padding: 0 3px !important;
          text-align: left !important;
        }
        #dcui-settings-modal #user_memo_table .memo_list .checkbox {
          display: flex !important;
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          align-items: center !important;
          gap: 2px;
        }
        #dcui-settings-modal #user_memo_table .memo_list label,
        #dcui-settings-modal #user_memo_table .memo_list .nik,
        #dcui-settings-modal #user_memo_table .memo_list .mone {
          display: inline !important;
          margin: 0 !important;
          padding: 0 !important;
          font: 8px/18px var(--dcui-font) !important;
          white-space: nowrap !important;
        }
        #dcui-settings-modal #user_memo_search {
          display: flex !important;
          align-items: stretch;
          gap: 4px;
          min-height: 22px !important;
          height: 22px !important;
          margin: 4px 0 0 !important;
          padding: 0 !important;
        }
        #dcui-settings-modal #user_memo_search .array_latest {
          position: relative !important;
          inset: 0 auto auto 0 !important;
          display: block !important;
          flex: 0 0 60px;
          width: 60px !important;
          min-width: 60px !important;
          max-width: 60px !important;
          margin: 0 !important;
          padding: 0 !important;
          align-self: stretch !important;
          transform: translateY(-1px) !important;
        }
        #dcui-settings-modal #user_memo_search .array_latest > .select_area {
          position: relative !important;
          display: block !important;
          width: 60px !important;
          min-width: 60px !important;
          max-width: 60px !important;
          margin: 0 !important;
          transform: none !important;
          overflow: hidden !important;
        }
        #dcui-settings-modal #user_memo_search .intbox {
          display: flex !important;
          min-width: 0;
          flex: 1;
          width: auto !important;
          margin: 0 !important;
        }
        #dcui-settings-modal #user_memo_search .intbox input {
          min-width: 0;
          width: 100% !important;
          flex: 1;
        }
        #dcui-settings-modal .dcui-native-settings-layer :is(.select_box, .ul_selectric),
        #dcui-settings-modal .dcui-native-settings-layer .select_area,
        #dcui-settings-modal .dcui-native-settings-layer .intbox,
        #dcui-settings-modal .dcui-native-settings-layer .intbox > :is(input, button) {
          box-sizing: border-box !important;
          min-height: 22px !important;
          height: 22px !important;
          line-height: 20px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .select_area {
          position: relative !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 18px 0 5px !important;
          overflow: hidden !important;
          white-space: nowrap !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .select_area > .icon_option_more {
          position: absolute !important;
          inset: 50% 5px auto auto !important;
          display: block !important;
          width: 9px !important;
          min-width: 9px !important;
          max-width: 9px !important;
          height: 6px !important;
          min-height: 6px !important;
          max-height: 6px !important;
          margin: 0 !important;
          padding: 0 !important;
          transform: translateY(-50%) !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .intbox {
          display: flex !important;
          min-width: 0 !important;
          align-items: stretch !important;
          gap: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .intbox > input {
          min-width: 0 !important;
          flex: 1 1 auto;
        }
        #dcui-settings-modal .dcui-native-settings-layer .intbox > button {
          flex: 0 0 auto;
          margin: 0 !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer :is(
          .tab_menubox > button,
          .block_tab > button,
          .btn_tabbox > button,
          .btn_txtbox > button,
          .btn_box > button,
          .select_area,
          .intbox > button,
          .btn_enroll,
          .radiobox > label,
          .cont_tit
        ) {
          max-width: 100% !important;
          white-space: nowrap !important;
        }
        #dcui-settings-modal #trusted_site_config .inner,
        #dcui-settings-modal #trusted_site_table {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
        }
        #dcui-settings-modal #trusted_site_config .trusted_site_wrap > .inner {
          height: auto !important;
          min-height: 0 !important;
          max-height: 270px !important;
          overflow: auto !important;
        }
        #dcui-settings-modal #trusted_site_config .scrollarea {
          height: auto !important;
          max-height: 260px !important;
          overflow: auto !important;
        }
        #dcui-settings-modal #trusted_site_config .empty_box {
          display: flex;
          box-sizing: border-box !important;
          min-height: 110px !important;
          height: 110px !important;
          align-items: center;
          justify-content: center;
        }
        #dcui-settings-modal #trusted_site_table .site_list {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        #dcui-settings-modal #trusted_site_table .site_list li {
          display: flex;
          min-height: 23px;
          align-items: center;
          gap: 3px;
          border-bottom: 1px solid var(--dcui-color-border-soft);
          padding: 0 3px;
        }
        #dcui-settings-modal #trusted_site_table .site_list p {
          min-width: 0;
          flex: 1;
          width: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 8px !important;
        }
        #dcui-settings-modal #trusted_site_table .site_list .del {
          display: inline-flex !important;
          box-sizing: border-box !important;
          width: 26px !important;
          min-width: 26px !important;
          max-width: 26px !important;
          height: 20px !important;
          min-height: 20px !important;
          flex: 0 0 26px !important;
          align-items: center !important;
          justify-content: center !important;
          margin: 0 !important;
          border: 0;
          padding: 0 !important;
          background: transparent;
          background-image: none !important;
          color: var(--dcui-color-muted);
          font: 8px/1.3 var(--dcui-font);
          text-indent: 0 !important;
          white-space: nowrap !important;
          word-break: keep-all !important;
          overflow-wrap: normal !important;
          cursor: pointer;
        }
        #dcui-settings-modal #trusted_site_table .site_list .del:hover {
          color: var(--dcui-color-link);
          text-decoration: underline;
        }
        #dcui-settings-modal #user_block .block_setting_box,
        #dcui-settings-modal #user_block .block_setting_box > .inner,
        #dcui-settings-modal #user_block .tabcontent,
        #dcui-settings-modal #user_block .pop_info,
        #dcui-settings-modal #user_block .word_wrap,
        #dcui-settings-modal #user_block .set_cont,
        #dcui-settings-modal #user_block .block_list {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
        #dcui-settings-modal #user_block .block_setting_box,
        #dcui-settings-modal #user_block .block_setting_box > .inner,
        #dcui-settings-modal #user_block .tabcontent,
        #dcui-settings-modal #user_block .word_wrap {
          min-height: 0 !important;
          height: auto !important;
        }
        #dcui-settings-modal #user_block .tabcontent {
          padding-left: 0 !important;
          padding-right: 0 !important;
          overflow-x: hidden !important;
        }
        #dcui-settings-modal #user_block .block_tab {
          display: flex !important;
          box-sizing: border-box !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        #dcui-settings-modal #user_block .block_tab button {
          width: auto !important;
          min-width: 0 !important;
          height: 23px !important;
          flex: 1 1 0;
          margin: 0 !important;
          padding: 0 5px !important;
          line-height: 21px !important;
        }
        #dcui-settings-modal #user_block,
        #dcui-settings-modal #user_block button,
        #dcui-settings-modal #user_block input,
        #dcui-settings-modal #user_block label,
        #dcui-settings-modal #user_block p,
        #dcui-settings-modal #user_block h4 {
          font-size: 8px !important;
          line-height: 1.25 !important;
        }
        #dcui-settings-modal #user_block .pop_content.block_setting_wrap {
          overflow: hidden !important;
        }
        #dcui-settings-modal #user_block .pop_content > .pop_info {
          min-height: 0 !important;
          padding: 4px 6px !important;
        }
        #dcui-settings-modal #user_block .pop_content > .pop_info p,
        #dcui-settings-modal #user_block .tabcontent > .pop_info h4,
        #dcui-settings-modal #user_block .tabcontent > .pop_info p {
          width: auto !important;
          margin: 0 !important;
        }
        #dcui-settings-modal #user_block .all_setting > .pop_info,
        #dcui-settings-modal #user_block .part_setting > .part_schbox + .pop_info {
          position: relative !important;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) 66px;
          grid-template-areas:
            "block-title block-switch"
            "block-description block-switch";
          min-height: 42px !important;
          align-items: center;
          column-gap: 7px;
          row-gap: 2px;
          padding: 5px 6px !important;
        }
        #dcui-settings-modal #user_block .all_setting > .pop_info h4,
        #dcui-settings-modal #user_block .part_setting > .part_schbox + .pop_info h4 {
          grid-area: block-title;
          display: inline-flex !important;
          align-items: center;
          white-space: nowrap;
        }
        #dcui-settings-modal #user_block .part_setting > .part_schbox + .pop_info h4 .icon_mini,
        #dcui-settings-modal #user_block .part_setting > .part_schbox + .pop_info h4 .icon_person {
          display: none !important;
        }
        #dcui-settings-modal #user_block .all_setting > .pop_info p,
        #dcui-settings-modal #user_block .part_setting > .part_schbox + .pop_info p {
          grid-area: block-description;
          min-width: 0;
          padding-right: 0 !important;
          word-break: keep-all;
          overflow-wrap: normal;
        }
        #dcui-settings-modal #user_block .all_setting > .pop_info .setting_onoff,
        #dcui-settings-modal #user_block .part_setting > .part_schbox + .pop_info .setting_onoff {
          position: static !important;
          grid-area: block-switch;
          width: 66px !important;
          margin: 0 !important;
          justify-self: end;
          align-self: center;
        }
        #dcui-settings-modal #user_block .word_wrap {
          padding: 0 6px !important;
        }
        #dcui-settings-modal #user_block .set_cont.add_text {
          grid-template-columns: 70px minmax(0, 1fr) 40px;
          min-height: 35px !important;
          height: auto !important;
          padding: 6px 0 !important;
          border-bottom: 1px dashed var(--dcui-color-border-strong);
        }
        #dcui-settings-modal #user_block .set_cont.add_text .cont_tit {
          display: block !important;
          justify-self: start;
          align-self: center;
          width: 70px !important;
          padding: 0 !important;
          text-align: left !important;
          white-space: nowrap !important;
          word-break: normal !important;
          overflow-wrap: normal !important;
        }
        #dcui-settings-modal #user_block .set_cont.add_text .intxt,
        #dcui-settings-modal #user_block .part_schbox .set_cont .intxt {
          box-sizing: border-box !important;
          width: 100% !important;
          min-width: 0 !important;
          height: 22px !important;
          padding: 2px 4px !important;
        }
        #dcui-settings-modal #user_block .set_cont.add_text .btn_enroll,
        #dcui-settings-modal #user_block .part_schbox .set_cont .btn_enroll {
          box-sizing: border-box !important;
          width: 40px !important;
          min-width: 40px !important;
          height: 22px !important;
          padding: 0 4px !important;
          line-height: 20px !important;
        }
        #dcui-settings-modal #user_block .set_cont.add_text .block_list:empty {
          display: none !important;
        }
        #dcui-settings-modal #user_block .set_cont.add_text .block_list:not(:empty) {
          display: flex !important;
          flex-wrap: wrap;
          gap: 3px 6px;
          min-height: 0 !important;
          height: auto !important;
          padding: 4px 0 0 !important;
        }
        #dcui-settings-modal #user_block .part_setting > .pop_info:first-child {
          display: block !important;
          min-height: 0 !important;
          padding: 5px 6px !important;
        }
        #dcui-settings-modal #user_block .part_setting > .pop_info:first-child h4 {
          margin-bottom: 4px !important;
          white-space: nowrap;
        }
        #dcui-settings-modal #user_block .block_list.gall {
          display: flex !important;
          flex-wrap: wrap;
          align-items: center;
          gap: 3px 7px;
          max-height: 58px;
          overflow: auto;
          padding: 0 !important;
        }
        #dcui-settings-modal #user_block .block_list.gall li,
        #dcui-settings-modal #user_block .block_list.gall li > span {
          display: inline-flex !important;
          width: auto !important;
          align-items: center;
          white-space: nowrap;
        }
        #dcui-settings-modal #user_block .block_list.gall li {
          min-height: 16px !important;
          height: 16px !important;
          gap: 2px;
          margin: 0 !important;
          padding: 0 !important;
          font-size: 8px !important;
          line-height: 16px !important;
        }
        #dcui-settings-modal #user_block .block_list.gall li > span {
          min-width: 0;
          height: 16px !important;
          font: 8px/16px var(--dcui-font) !important;
        }
        #dcui-settings-modal #user_block .block_list.gall .icon_mini,
        #dcui-settings-modal #user_block .block_list.gall .icon_person {
          display: none !important;
        }
        #dcui-settings-modal #user_block .block_list.gall li > button {
          position: static !important;
          display: inline-flex !important;
          width: 12px !important;
          min-width: 12px !important;
          height: 12px !important;
          align-items: center;
          justify-content: center;
          margin: 0 !important;
          padding: 0 !important;
        }
        #dcui-settings-modal #user_block .part_schbox {
          display: grid !important;
          grid-template-columns: 62px minmax(0, 1fr);
          grid-template-areas:
            "gallery-title gallery-types"
            "gallery-search gallery-search"
            "gallery-results gallery-results"
            "gallery-empty gallery-empty";
          box-sizing: border-box !important;
          width: 100% !important;
          min-height: 0 !important;
          gap: 5px 6px;
          padding: 6px 6px 10px !important;
          overflow: visible !important;
        }
        #dcui-settings-modal #user_block .part_schbox + .pop_info {
          margin-top: 5px !important;
          border-top: 1px solid var(--dcui-color-border-strong);
        }
        #dcui-settings-modal #user_block .part_schbox .fl {
          float: none !important;
        }
        #dcui-settings-modal #user_block .part_schbox .gall_sel_tit {
          grid-area: gallery-title;
          margin: 0 !important;
          white-space: nowrap;
          align-self: center;
        }
        #dcui-settings-modal #user_block .part_schbox > .fl:not(.gall_sel_tit):not(.set_cont) {
          grid-area: gallery-types;
          display: flex !important;
          min-width: 0;
          align-items: center;
          gap: 7px;
          white-space: nowrap;
        }
        #dcui-settings-modal #user_block .part_schbox .radiobox,
        #dcui-settings-modal #user_block .part_schbox .radiobox label {
          display: inline-flex !important;
          align-items: center;
          white-space: nowrap;
        }
        #dcui-settings-modal #user_block .part_schbox .radiobox {
          position: relative !important;
          height: 16px !important;
          gap: 2px;
          padding: 0 !important;
        }
        #dcui-settings-modal #user_block .part_schbox .radiobox input {
          position: absolute !important;
          width: 12px !important;
          height: 12px !important;
          margin: 0 !important;
          opacity: 0;
          cursor: pointer;
        }
        #dcui-settings-modal #user_block .part_schbox .radiobox .checkmark {
          position: static !important;
          display: inline-block !important;
          order: -1;
          box-sizing: border-box !important;
          width: 10px !important;
          height: 10px !important;
          margin: 0 !important;
          border: 1px solid var(--dcui-color-border-control) !important;
          border-radius: 50%;
          background: var(--dcui-color-surface) !important;
        }
        #dcui-settings-modal #user_block .part_schbox .radiobox input:checked + .checkmark {
          border-color: var(--dcui-color-nav-light) !important;
          background: var(--dcui-color-nav-light) !important;
          box-shadow: inset 0 0 0 2px var(--dcui-color-control-highlight);
        }
        #dcui-settings-modal #user_block .part_schbox > .set_cont {
          grid-area: gallery-search;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) 40px;
          gap: 4px;
          min-height: 0 !important;
          padding: 0 !important;
        }
        #dcui-settings-modal #user_block .part_schbox .block_sch_gall {
          grid-area: gallery-results;
          position: static !important;
          float: none !important;
          box-sizing: border-box !important;
          width: 100% !important;
          min-height: 0 !important;
          height: auto !important;
          max-height: 80px;
          overflow: auto;
          margin: 0 !important;
          padding: 0 !important;
        }
        #dcui-settings-modal #user_block .part_schbox .block_sch_gall:empty {
          display: none !important;
        }
        #dcui-settings-modal #user_block .part_schbox .block_sch_gall:not(:empty) {
          display: block !important;
          border: 1px solid var(--dcui-color-border-strong);
          padding: 3px 5px !important;
        }
        #dcui-settings-modal #user_block .part_schbox .block_sch_gall li {
          min-height: 18px !important;
          margin: 0 !important;
          padding: 0 !important;
          font: 8px/18px var(--dcui-font) !important;
        }
        #dcui-settings-modal #user_block .part_schbox .empty_sch_gall {
          grid-area: gallery-empty;
          margin: 0 !important;
        }
        #dcui-settings-modal #user_block .pop_content.block_setting_wrap > .btn_box {
          position: static !important;
          display: flex !important;
          min-height: 30px !important;
          height: 30px !important;
          align-items: center;
          justify-content: center;
          gap: 4px;
          margin: 0 !important;
          padding: 4px 6px !important;
          border-top: 1px solid var(--dcui-color-border-strong);
        }
        #dcui-settings-modal #autozzal_setting_pop .jjalbang_set,
        #dcui-settings-modal #autozzal_setting_pop .tabcontent,
        #dcui-settings-modal #autozzal_setting_pop .scrollarea,
        #dcui-settings-modal #headTail_lay .txtmark_setting_wrap,
        #dcui-settings-modal #headTail_lay .tabcontent,
        #dcui-settings-modal #headTail_lay .tabbox,
        #dcui-settings-modal #headTail_lay .set_cont {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
        #dcui-settings-modal #autozzal_setting_pop .jjalbang_list img,
        #dcui-settings-modal #autozzal_setting_pop .jjalbang_list .jjal {
          max-width: 125px !important;
          max-height: 125px !important;
          object-fit: contain;
        }
        #dcui-settings-modal #autozzal_setting_pop #autozzal_setting > .inner,
        #dcui-settings-modal #autozzal_setting_pop #autozzal_setting > .inner > .tabcontent,
        #dcui-settings-modal #autozzal_setting_pop .jjalbang_set .scrollarea,
        #dcui-settings-modal #autozzal_setting_pop .jjalbang_set .empty_box {
          height: auto !important;
          min-height: 0 !important;
        }
        #dcui-settings-modal #autozzal_setting_pop #autozzal_setting > .inner {
          max-height: 330px !important;
          overflow: auto !important;
        }
        #dcui-settings-modal #autozzal_setting_pop .jjalbang_set .scrollarea {
          max-height: 220px !important;
        }
        #dcui-settings-modal #autozzal_setting_pop .jjalbang_set .empty_box {
          padding: 10px 6px !important;
        }
        #dcui-settings-modal #headTail_lay .pop_info,
        #dcui-settings-modal #headTail_lay .set_cont > .inr {
          box-sizing: border-box !important;
          width: 100% !important;
        }
        #dcui-settings-modal #headTail_lay .set_cont > .inr {
          display: flex !important;
          min-height: 21px;
          align-items: center;
          gap: 5px;
        }
        #dcui-settings-modal #headTail_lay .textarea_box,
        #dcui-settings-modal #headTail_lay textarea {
          width: 100% !important;
        }
        #dcui-settings-modal #headTail_lay textarea {
          min-height: 38px !important;
          padding: 4px !important;
          line-height: 1.3 !important;
          resize: vertical;
        }
        #dcui-settings-modal #headTail_lay label,
        #dcui-settings-modal #headTail_lay h4,
        #dcui-settings-modal #headTail_lay p,
        #dcui-settings-modal #headTail_lay .tit {
          font-size: 8px !important;
          line-height: 1.25 !important;
        }
        #dcui-settings-modal #spoiler_set_lyr .spoiler_setting_wrap,
        #dcui-settings-modal #spoiler_set_lyr .inner,
        #dcui-settings-modal #spoiler_set_lyr .set_cont {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
        }
        #dcui-settings-modal #spoiler_set_lyr .set_cont {
          position: relative;
          min-height: 40px !important;
          padding: 5px 40px 5px 6px !important;
        }
        #dcui-settings-modal #spoiler_set_lyr .set_cont .tit,
        #dcui-settings-modal #spoiler_set_lyr .set_cont .txt {
          width: auto !important;
          margin: 0 !important;
        }
        #dcui-settings-modal #spoiler_set_lyr .set_cont .tit {
          font-size: 8px !important;
          line-height: 1.25 !important;
        }
        #dcui-settings-modal #spoiler_set_lyr .set_cont .txt,
        #dcui-settings-modal #spoiler_set_lyr .pop_info {
          font-size: 8px !important;
          line-height: 1.25 !important;
        }
        #dcui-settings-modal #user_block .pop_info p {
          white-space: normal !important;
        }
        #dcui-settings-modal #user_block .set_cont.add_text {
          display: grid !important;
          grid-template-columns: minmax(66px, 78px) minmax(0, 1fr) auto;
          align-items: center;
          gap: 4px;
        }
        #dcui-settings-modal #user_block .set_cont.add_text .cont_tit {
          position: static !important;
          width: auto !important;
          margin: 0 !important;
        }
        #dcui-settings-modal #user_block .set_cont.add_text .intxt {
          width: 100% !important;
          min-width: 0 !important;
        }
        #dcui-settings-modal #user_block .set_cont.add_text .btn_enroll {
          position: static !important;
          margin: 0 !important;
        }
        #dcui-settings-modal #user_block .set_cont.add_text .block_list {
          grid-column: 2 / -1;
        }
        #dcui-settings-modal .dcui-native-settings-layer .dcui-native-settings-nested,
        #dcui-settings-modal .dcui-native-settings-layer.dcui-native-settings-auxiliary {
          position: relative !important;
          inset: auto !important;
          width: 100% !important;
          max-width: 100% !important;
          height: auto !important;
          margin: 7px 0 0 !important;
          transform: none !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer.dcui-native-settings-auxiliary > .pop_content > .pop_head:first-child,
        #dcui-settings-modal .dcui-native-settings-layer .dcui-native-settings-nested > .pop_content > .pop_head:first-child {
          position: relative !important;
          display: flex !important;
          box-sizing: border-box !important;
          width: 100% !important;
          min-height: 24px !important;
          height: 24px !important;
          align-items: center !important;
          margin: 0 !important;
          padding: 0 25px 0 7px !important;
          border: 0 !important;
          border-bottom: 1px solid var(--dcui-color-border-strong) !important;
          background: var(--dcui-color-surface-muted) !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer.dcui-native-settings-auxiliary > .pop_content > .pop_head:first-child :is(h3, strong),
        #dcui-settings-modal .dcui-native-settings-layer .dcui-native-settings-nested > .pop_content > .pop_head:first-child :is(h3, strong) {
          margin: 0 !important;
          padding: 0 !important;
          color: var(--dcui-color-text-soft) !important;
          font: 700 9px/23px var(--dcui-font) !important;
          white-space: nowrap !important;
        }
        #dcui-settings-modal .dcui-native-settings-auxiliary > :is(.poply_whiteclose, .poply_bgblueclose, .poply_greyclose, .poply_bgclose, .poply_close, .btn_close),
        #dcui-settings-modal .dcui-native-settings-nested > :is(.poply_whiteclose, .poply_bgblueclose, .poply_greyclose, .poply_bgclose, .poply_close, .btn_close) {
          position: absolute !important;
          top: 3px !important;
          right: 4px !important;
          left: auto !important;
          bottom: auto !important;
          z-index: 3 !important;
          display: block !important;
          width: 18px !important;
          height: 18px !important;
          margin: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          background: transparent !important;
          color: transparent !important;
          font-size: 0 !important;
          cursor: pointer !important;
        }
        #dcui-settings-modal .checkbox {
          position: relative !important;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        #dcui-settings-modal .checkbox input[type="checkbox"] {
          position: absolute !important;
          width: 1px !important;
          height: 1px !important;
          opacity: 0;
          pointer-events: none;
        }
        #dcui-settings-modal .checkbox .checkmark {
          position: relative !important;
          display: inline-block;
          flex: 0 0 12px;
          width: 12px !important;
          height: 12px !important;
          border: 1px solid var(--dcui-color-border-control) !important;
          border-radius: 2px;
          background: var(--dcui-color-surface) !important;
          background-image: none !important;
        }
        #dcui-settings-modal .checkbox input[type="checkbox"]:checked + .checkmark {
          border-color: var(--dcui-color-nav-light) !important;
          background: var(--dcui-color-nav-light) !important;
        }
        #dcui-settings-modal .checkbox input[type="checkbox"]:checked + .checkmark::after {
          position: absolute;
          top: 1px;
          left: 3px;
          width: 3px;
          height: 6px;
          border: solid var(--dcui-color-on-accent);
          border-width: 0 2px 2px 0;
          content: "";
          transform: rotate(45deg);
        }
        /* The native settings were compressed aggressively to fit the side panel.
           Keep the compact layout, but restore one readable size step throughout. */
        #dcui-settings-modal .dcui-settings-modal-dialog {
          grid-template-rows: 30px minmax(0, 1fr);
          font-size: 9px;
          line-height: 1.3;
        }
        #dcui-settings-modal .dcui-settings-modal-dialog > header {
          padding-right: 7px;
          padding-left: 9px;
          font-size: 11px;
        }
        #dcui-settings-modal .dcui-settings-modal-host {
          padding: 5px;
        }
        #dcui-settings-modal .dcui-native-settings-layer > .pop_content,
        #dcui-settings-modal .dcui-native-settings-layer.pop_content {
          font-size: 9px !important;
          line-height: 1.3 !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer :is(button, input, textarea, select),
        #dcui-settings-modal .dcui-native-settings-layer :is(p, h4, label, li, a, .cont_tit),
        #dcui-settings-modal #user_block :is(button, input, label, p, h4),
        #dcui-settings-modal #headTail_lay :is(label, h4, p, .tit),
        #dcui-settings-modal #spoiler_set_lyr :is(.set_cont .tit, .set_cont .txt, .pop_info) {
          font-size: 9px !important;
          line-height: 1.3 !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer input[type="text"],
        #dcui-settings-modal .dcui-native-settings-layer select,
        #dcui-settings-modal .dcui-native-settings-layer :is(.select_box, .ul_selectric),
        #dcui-settings-modal .dcui-native-settings-layer .select_area,
        #dcui-settings-modal .dcui-native-settings-layer .intbox,
        #dcui-settings-modal .dcui-native-settings-layer .intbox > :is(input, button) {
          min-height: 24px !important;
          height: 24px !important;
          line-height: 22px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox,
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox button,
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox button.on,
        #dcui-settings-modal #user_block .block_tab button {
          min-height: 25px !important;
          height: 25px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .tab_menubox button,
        #dcui-settings-modal #user_block .block_tab button {
          font-size: 9px !important;
          line-height: 23px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer .btn_box > button,
        #dcui-settings-modal #user_memo_table .btn_txtbox.copydel > button {
          min-height: 24px !important;
          height: 24px !important;
          line-height: 22px !important;
        }
        #dcui-settings-modal #user_memo_table .memo_list li,
        #dcui-settings-modal #user_memo_table .memo_list .btn-wrap,
        #dcui-settings-modal #user_memo_table .memo_list .btn-wrap > .btn {
          min-height: 20px !important;
          height: 20px !important;
        }
        #dcui-settings-modal #user_memo_table .memo_list :is(label, .nik, .mone) {
          font-size: 9px !important;
          line-height: 20px !important;
        }
        #dcui-settings-modal #user_memo_search {
          min-height: 24px !important;
          height: 24px !important;
        }
        #dcui-settings-modal #user_memo_search .array_latest,
        #dcui-settings-modal #user_memo_search .array_latest > .select_area {
          flex-basis: 66px;
          width: 66px !important;
          min-width: 66px !important;
          max-width: 66px !important;
        }
        #dcui-settings-modal #trusted_site_table .site_list li {
          min-height: 25px;
        }
        #dcui-settings-modal #trusted_site_table .site_list :is(p, .del) {
          font-size: 9px !important;
        }
        #dcui-settings-modal #user_block .set_cont.add_text {
          min-height: 39px !important;
        }
        #dcui-settings-modal #user_block .set_cont.add_text .intxt,
        #dcui-settings-modal #user_block .part_schbox .set_cont .intxt,
        #dcui-settings-modal #user_block .set_cont.add_text .btn_enroll,
        #dcui-settings-modal #user_block .part_schbox .set_cont .btn_enroll {
          height: 24px !important;
          line-height: 22px !important;
        }
        #dcui-settings-modal #user_block .block_list.gall li,
        #dcui-settings-modal #user_block .block_list.gall li > span {
          min-height: 18px !important;
          height: 18px !important;
          font-size: 9px !important;
          line-height: 18px !important;
        }
        #dcui-settings-modal #user_block .part_schbox .block_sch_gall li {
          min-height: 20px !important;
          font-size: 9px !important;
          line-height: 20px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer.dcui-native-settings-auxiliary > .pop_content > .pop_head:first-child,
        #dcui-settings-modal .dcui-native-settings-layer .dcui-native-settings-nested > .pop_content > .pop_head:first-child {
          min-height: 26px !important;
          height: 26px !important;
        }
        #dcui-settings-modal .dcui-native-settings-layer.dcui-native-settings-auxiliary > .pop_content > .pop_head:first-child :is(h3, strong),
        #dcui-settings-modal .dcui-native-settings-layer .dcui-native-settings-nested > .pop_content > .pop_head:first-child :is(h3, strong) {
          font-size: 10px !important;
          line-height: 25px !important;
        }
        html.dcui-enabled #dcui-sidebar .setting_list li.dcui-settings-trigger-active > button {
          background: var(--dcui-color-surface-selected);
          color: var(--dcui-color-link);
          font-weight: 700;
        }
      `;
      document.documentElement.appendChild(style);
    },
  });

  let subjectTargetPromise = null;
  const SUBJECT_TARGET_CACHE_TTL_MS = 30 * 60 * 1000;

  const ListView = Object.freeze({
    mount() {
      const listRoot = DcAdapter.listRoot();
      const listTable = DcAdapter.listTable();
      if (!listRoot || !listTable) return null;

      listRoot.classList.add("dcui-list");
      listTable.classList.add("dcui-list-table");
      this.decorateRows();
      this.decorateTable(listTable);
      this.decorateControls();
      this.syncSubjectCells();
      this.injectStyle();
      this.watchTable(listRoot);
      return { listRoot, listTable };
    },

    decorateRows(root = document) {
      const currentPostNo = pageContext.pageType === "view"
        ? new URL(location.href).searchParams.get("no")
        : null;
      for (const row of DcAdapter.queryAll("table.gall_list tr.ub-content", root)) {
        if (row.dataset.dcuiDecorated === "true") continue;

        const numberText = cleanText(row.querySelector(".gall_num")?.textContent);
        const subjectText = cleanText(row.querySelector(".gall_subject")?.textContent);
        const rowType = cleanText(row.dataset.type);
        const postLink = row.querySelector('.gall_tit a[href*="/view/"][href*="no="]');
        let rowPostNo = /^\d+$/.test(numberText) ? numberText : "";
        try {
          if (postLink) rowPostNo = new URL(postLink.href, location.href).searchParams.get("no") || rowPostNo;
        } catch (_error) {
          // Keep the number cell fallback for malformed links.
        }
        row.classList.toggle("dcui-row-notice", rowType === "icon_notice" || numberText === "공지");
        row.classList.toggle("dcui-row-survey", numberText === "설문");
        row.classList.toggle("dcui-row-ad", numberText === "AD" || subjectText === "AD" || Boolean(row.querySelector(".icon_ad")));
        row.classList.toggle("dcui-current-post", Boolean(currentPostNo && rowPostNo === currentPostNo));
        row.dataset.dcuiDecorated = "true";
      }
    },

    decorateTable(listTable) {
      const rows = Array.from(listTable.querySelectorAll("tbody tr.ub-content"));
      const headers = Array.from(listTable.querySelectorAll("thead th"));
      const headerByText = (label) => headers.find((header) => cleanText(header.textContent) === label) || null;
      const numberHeader = listTable.querySelector("thead .gall_num") || headerByText("번호");
      const subjectHeader = listTable.querySelector("thead .gall_subject") || headerByText("말머리");
      const hasSubjectColumn = rows.some((row) => row.querySelector(".gall_subject"));
      listTable.classList.toggle("dcui-has-subject-column", hasSubjectColumn);

      if (numberHeader) {
        const label = hasSubjectColumn ? "번호" : "말머리";
        if (cleanText(numberHeader.textContent) !== label) numberHeader.textContent = label;
        numberHeader.classList.toggle("dcui-hidden-number", hasSubjectColumn);
        numberHeader.classList.toggle("dcui-tab-cell", !hasSubjectColumn);
      }
      if (subjectHeader) {
        if (cleanText(subjectHeader.textContent) !== "말머리") subjectHeader.textContent = "말머리";
        subjectHeader.classList.add("dcui-tab-cell");
      }
      if (hasSubjectColumn && listTable.dataset.dcuiNumberColumnRemoved !== "true") {
        const numberColumnIndex = headers.indexOf(numberHeader);
        const numberColumn = listTable.querySelectorAll("colgroup col")[numberColumnIndex];
        numberColumn?.remove();
        listTable.dataset.dcuiNumberColumnRemoved = "true";
      }

      for (const row of rows) {
        const numberCell = row.querySelector(".gall_num");
        const subjectCell = row.querySelector(".gall_subject");
        const originalNumber = cleanText(numberCell?.textContent);
        const tabLabel = this.tabLabel(row, originalNumber, subjectCell);

        if (hasSubjectColumn) {
          numberCell?.classList.add("dcui-hidden-number");
          if (subjectCell) {
            subjectCell.classList.add("dcui-tab-cell");
            if (!cleanText(subjectCell.textContent)) subjectCell.textContent = tabLabel;
          }
        } else if (numberCell) {
          numberCell.classList.add("dcui-tab-cell");
          if (cleanText(numberCell.textContent) !== tabLabel) numberCell.textContent = tabLabel;
        }
      }

      const labels = [
        [".gall_tit", "제목", "제목"],
        [".gall_writer", "글쓴이", "글쓴이"],
        [".gall_date", "작성일", "날짜"],
        [".gall_count", "조회", "조회"],
        [".gall_recommend", "추천", "추천"],
      ];
      for (const [selector, originalLabel, label] of labels) {
        const header = listTable.querySelector(`thead ${selector}`) || headerByText(originalLabel);
        if (header) header.textContent = label;
      }
    },

    watchTable(listRoot) {
      if (listRoot.__dcuiListTableObserver || typeof MutationObserver !== "function") return;
      let refreshQueued = false;
      let observer = null;
      const refresh = () => {
        refreshQueued = false;
        const listTable = DcAdapter.listTable(listRoot);
        if (!listTable) return;
        listTable.classList.add("dcui-list-table");
        this.decorateRows(listTable);
        this.decorateTable(listTable);
        this.syncSubjectCells();
        // Refresher changes history and replaces tbody without reloading.
        // Its preview can temporarily change a list URL to a view URL.
        if (PageContext.fromLocation()?.pageType === pageContext.pageType) {
          ShellView.configureDirectionalShortcuts(pageContext,
            document.querySelector('#dcui-sidebar [data-role="sidePrevious"]'),
            document.querySelector('#dcui-sidebar [data-role="sideNext"]'));
        }
        observer?.takeRecords();
      };
      const queueRefresh = () => {
        if (refreshQueued) return;
        refreshQueued = true;
        queueMicrotask(refresh);
      };
      observer = new MutationObserver((records) => {
        const relevant = records.some((record) => {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          if (target?.closest("table.gall_list")) return true;
          return Array.from(record.addedNodes).some((node) => node instanceof Element
            && (node.matches("table.gall_list") || Boolean(node.querySelector("table.gall_list"))));
        });
        if (relevant) queueRefresh();
      });
      observer.observe(listRoot, { childList: true, subtree: true });
      listRoot.__dcuiListTableObserver = observer;
    },

    tabLabel(row, numberText, subjectCell) {
      const subject = cleanText(subjectCell?.textContent);
      if (subject) return subject;
      if (row.classList.contains("dcui-row-notice") || numberText === "공지") return "공지";
      if (row.classList.contains("dcui-row-survey") || numberText === "설문") return "설문";
      if (row.classList.contains("dcui-row-ad") || numberText === "AD") return "AD";
      return "일반";
    },

    shouldShowGalleryCover(currentLocation = location) {
      if (pageContext.pageType !== "list") return false;
      const currentUrl = new URL(currentLocation.href);
      const page = currentUrl.searchParams.get("page");
      if (page !== null && page !== "1") return false;
      if (currentUrl.searchParams.has("search_head")) return false;
      const exceptionMode = currentUrl.searchParams.get("exception_mode") || "";
      if (exceptionMode && exceptionMode !== "recommend") return false;
      return !["s_type", "s_keyword", "search_pos", "search_keyword", "keyword"]
        .some((key) => cleanText(currentUrl.searchParams.get(key)));
    },

    mountMiniMemberControl(meta, root = document, sourceBoxOverride = null) {
      if (!meta) return null;
      let join = meta.querySelector(".dcui-gallery-join");
      const memberSource = meta.querySelector(".dcui-gallery-members.membernum")
        || root.querySelector(".mini_set.membernum, .membernum")
        || document.querySelector(".mini_intro_box .mini_set.membernum, .mini_intro_box .membernum");
      const sourceBox = sourceBoxOverride
        || root.querySelector(":scope > .box")
        || document.querySelector(".issue_contentbox .img_contbox .membernum + .box, .minor_intro_box .img_contbox .membernum + .box, .mini_intro_box .img_contbox .membernum + .box, .person_intro_box .img_contbox .membernum + .box")
        || (memberSource?.nextElementSibling?.matches(".box") ? memberSource.nextElementSibling : null);
      const nativeBox = join?.querySelector(":scope > .box") || sourceBox;
      const sourceState = nativeBox?.parentElement !== join
        && nativeBox?.nextElementSibling?.matches(".txt.font_grey")
        && /가입|승인/.test(cleanText(nativeBox.nextElementSibling.textContent))
        ? nativeBox.nextElementSibling
        : null;
      const state = join?.querySelector(":scope > .txt.font_grey") || sourceState;
      const looseControl = join?.querySelector(":scope > .smallestgag")
        || root.querySelector(".box > .smallestgag");
      if (!nativeBox && !state && !looseControl) return null;

      for (const node of Array.from(nativeBox?.childNodes || [])) {
        if (node.nodeType === Node.TEXT_NODE && cleanText(node.textContent) === "<") node.remove();
      }

      if (!join) {
        join = document.createElement("div");
        join.className = "dcui-gallery-join";
      }
      if (memberSource) join.appendChild(memberSource);
      if (nativeBox) join.appendChild(nativeBox);
      else if (looseControl) join.appendChild(looseControl);
      if (state) join.appendChild(state);
      const question = document.querySelector("#join_question_div");
      if (question) join.appendChild(question);
      meta.appendChild(join);
      return join;
    },

    mountGalleryIntro(pageHead) {
      if (!pageHead) return null;
      const existing = document.querySelector(".dcui-gallery-intro");
      if (existing) {
        const text = existing.querySelector(".dcui-gallery-intro-text");
        if (pageHead.parentElement !== existing) existing.insertBefore(pageHead, text || null);
        pageHead.classList.add("dcui-gallery-intro-title");
        this.mountMiniMemberControl(existing.querySelector(".dcui-gallery-meta"));
        return existing;
      }

      const source = document.querySelector(".issue_contentbox .img_contbox, .minor_intro_box .img_contbox, .mini_intro_box .img_contbox, .person_intro_box .img_contbox");
      if (!source) return null;
      const coverSource = source.querySelector(".mintro_imgbox .cover, .bgcover .cover");
      const description = cleanText(source.querySelector(".mintro_txt")?.textContent);
      const rankLabel = cleanText(source.querySelector(".mini_ranktxt, .rank_txt, .ranktxt")?.textContent);
      const rankNumber = cleanText(source.querySelector(".mini_ranknum, .rank_num, .ranknum")?.textContent);
      const rankIconSource = source.querySelector(".rankingcon");
      const memberLabel = cleanText(source.querySelector(".mini_set.membernum .txt, .membernum .txt")?.textContent);
      const memberNumber = cleanText(source.querySelector(".mini_set.membernum .members_num, .membernum .members_num")?.textContent);
      const memberSource = source.querySelector(".mini_set.membernum, .membernum");
      const memberBox = memberSource?.nextElementSibling?.matches(".box")
        ? memberSource.nextElementSibling
        : null;
      const memberState = memberBox?.nextElementSibling?.matches(".txt.font_grey")
        && /가입|승인/.test(cleanText(memberBox.nextElementSibling.textContent))
        ? memberBox.nextElementSibling
        : null;
      const hasMemberControl = Boolean(memberState
        || Array.from(memberBox?.children || []).some((node) => node.tagName !== "SCRIPT"));
      if (!coverSource && !description && !rankLabel && !rankNumber && !memberLabel && !memberNumber && !hasMemberControl) return null;

      const intro = document.createElement("section");
      intro.className = "dcui-gallery-intro";
      intro.setAttribute("aria-label", "갤러리 소개");
      const anchorParent = pageHead.parentNode;
      const anchorNext = pageHead.nextSibling;
      let galleryCover = null;

      if (coverSource && this.shouldShowGalleryCover()) {
        const imageContainer = document.createElement("div");
        imageContainer.className = "dcui-gallery-cover";
        const popupSource = source.querySelector(".mintro_imgbox")?.getAttribute("href") || "";
        const popupUrl = popupSource.match(/imgPop\(\s*['"]([^'"]+)/)?.[1] || "";
        const originalImageUrl = popupUrl.replace(/\/viewimagePop\.php(?=\?)/, "/viewimage.php");
        const backgroundImage = coverSource.style.backgroundImage || getComputedStyle(coverSource).backgroundImage;
        const thumbnailUrl = backgroundImage.match(/^url\((['"]?)(.*)\1\)$/)?.[2] || "";
        const imageUrl = originalImageUrl || thumbnailUrl;
        if (imageUrl) {
          const image = document.createElement("img");
          image.src = imageUrl;
          image.alt = "갤러리 대문 이미지";
          image.decoding = "async";
          if (originalImageUrl && thumbnailUrl) {
            const useThumbnailFallback = () => {
              if (image.src === thumbnailUrl) return;
              image.src = thumbnailUrl;
            };
            image.addEventListener("error", useThumbnailFallback, { once: true });
            image.addEventListener("load", () => {
              const ratio = image.naturalHeight ? image.naturalWidth / image.naturalHeight : 0;
              if (image.naturalWidth < 128 || image.naturalHeight < 64 || ratio > 4 || ratio < 0.25) {
                useThumbnailFallback();
              }
            });
          }
          imageContainer.appendChild(image);
        } else {
          const cover = document.createElement("span");
          cover.style.backgroundImage = backgroundImage;
          cover.setAttribute("role", "img");
          cover.setAttribute("aria-label", "갤러리 대문 이미지");
          imageContainer.appendChild(cover);
        }
        galleryCover = imageContainer;
      }

      pageHead.classList.add("dcui-gallery-intro-title");
      intro.appendChild(pageHead);

      const text = document.createElement("div");
      text.className = "dcui-gallery-intro-text";
      if (rankLabel || rankNumber || memberLabel || memberNumber || hasMemberControl) {
        const meta = document.createElement("div");
        meta.className = "dcui-gallery-meta";
        if (rankLabel || rankNumber) {
          const rank = document.createElement("span");
          rank.className = "dcui-gallery-rank";
          const icon = rankIconSource?.cloneNode(false) || document.createElement("span");
          icon.classList.add("dcui-gallery-rank-icon");
          icon.setAttribute("aria-hidden", "true");
          if (!rankIconSource) {
            icon.classList.add("dcui-gallery-rank-icon-fallback");
            icon.textContent = "●";
          }
          const value = document.createElement("strong");
          value.textContent = [rankLabel, rankNumber].filter(Boolean).join(" ");
          rank.append(icon, value);
          meta.appendChild(rank);
        }
        if (memberLabel || memberNumber) {
          if (memberSource) {
            memberSource.classList.add("dcui-gallery-members");
            meta.appendChild(memberSource);
          } else {
            const member = document.createElement("span");
            member.className = "dcui-gallery-members";
            member.innerHTML = '<span class="dcui-gallery-members-icon" aria-hidden="true"></span>';
            const value = document.createElement("strong");
            value.textContent = [memberLabel || "멤버", memberNumber].filter(Boolean).join(" ");
            member.appendChild(value);
            meta.appendChild(member);
          }
        }
        this.mountMiniMemberControl(meta, source, memberBox);
        text.appendChild(meta);
      }
      if (description) {
        const paragraph = document.createElement("p");
        paragraph.textContent = description;
        text.appendChild(paragraph);
      }
      intro.appendChild(text);
      if (galleryCover) anchorParent?.insertBefore(galleryCover, anchorNext);
      anchorParent?.insertBefore(intro, anchorNext);
      return intro;
    },

    bindRelationPopup(pageHead) {
      const relationButton = pageHead?.querySelector(".gall_issuebox .relate");
      if (!relationButton) return;
      AnchoredPopupController.bind({
        trigger: relationButton,
        popupSelector: "#relation_popup",
        anchor: () => relationButton.closest(".page_head") || relationButton,
        popupClass: "dcui-relation-popup",
        nativeFunction: "open_relation",
        closeSelector: ".poply_bgblueclose",
      });
    },

    managerNames(row) {
      if (!row) return [];
      const names = [];
      const seen = new Set();
      const nameNodes = Array.from(row.querySelectorAll(".mng_nick"));
      for (const source of nameNodes) {
        const copy = source.cloneNode(true);
        copy.querySelectorAll(".mng_nick").forEach((nested) => nested.remove());
        copy.querySelectorAll("button, script, style, .btn_user_data, .pop_wrap").forEach((node) => node.remove());
        for (const idNode of copy.querySelectorAll("[title]")) {
          const fullId = cleanText(idNode.getAttribute("title"));
          if (fullId) idNode.textContent = fullId.length > 8 ? `${fullId.slice(0, 8)}…` : fullId;
        }
        const name = cleanText(copy.textContent);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }

      if (names.length === 0) {
        const fallback = row.querySelector(".cont")?.cloneNode(true);
        fallback?.querySelectorAll("button, script, style, .btn_user_data, .pop_wrap").forEach((node) => node.remove());
        const raw = cleanText(fallback?.textContent);
        for (const name of raw.split(/\s*,\s*|\s{2,}/).map(cleanText).filter(Boolean)) {
          if (seen.has(name)) continue;
          seen.add(name);
          names.push(name);
        }
      }
      return names;
    },

    managerRows() {
      const rows = [];
      const seen = new Set();
      const labels = new Set(["매니저", "부매니저", "개설일"]);
      const selectors = [
        ".issue_contentbox .info_cont",
        ".minor_intro_box .info_cont",
        ".mini_intro_box .info_cont",
        ".person_intro_box .info_cont",
        ".info_contbox .info_cont",
      ];
      for (const row of document.querySelectorAll(selectors.join(","))) {
        const label = cleanText(row.querySelector(".tit, dt, strong")?.textContent).replace(/:$/, "");
        if (!labels.has(label) || seen.has(label)) continue;
        seen.add(label);
        rows.push({ label, row });
      }
      return rows;
    },

    mountManagerLine(pageHead) {
      if (!pageHead) return null;

      const galleryIntro = pageHead.closest(".dcui-gallery-intro");
      const existing = document.querySelector(".dcui-manager-line");
      if (existing) {
        if (galleryIntro) galleryIntro.appendChild(existing);
        else if (pageHead.nextElementSibling !== existing) pageHead.insertAdjacentElement("afterend", existing);
        return existing;
      }

      const rows = this.managerRows();
      const rowByLabel = (label) => rows.find((item) => item.label === label)?.row || null;
      const managers = this.managerNames(rowByLabel("매니저"));
      const subManagers = this.managerNames(rowByLabel("부매니저"));
      const openingDate = cleanText(rowByLabel("개설일")?.querySelector(".cont, dd, p")?.textContent);
      const reportButton = document.querySelector([
        ".issue_contentbox .btn_mngadmin_report",
        ".minor_intro_box .btn_mngadmin_report",
        ".mini_intro_box .btn_mngadmin_report",
        ".person_intro_box .btn_mngadmin_report",
        ".info_contbox .btn_mngadmin_report",
      ].join(","));
      if (managers.length === 0 && subManagers.length === 0 && !openingDate && !reportButton) return null;

      const introText = galleryIntro?.querySelector(".dcui-gallery-intro-text");
      if (openingDate && introText && !introText.querySelector(".dcui-opening-date")) {
        const date = document.createElement("span");
        date.className = "dcui-opening-date";
        date.innerHTML = "<strong>개설일:</strong> ";
        date.append(document.createTextNode(openingDate));
        introText.appendChild(date);
      }

      const line = document.createElement("div");
      line.className = "dcui-manager-line";
      line.title = [
        managers.length ? `매니저: ${managers.join(", ")}` : "",
        subManagers.length ? `부매니저: ${subManagers.join(", ")}` : "",
        openingDate ? `개설일: ${openingDate}` : "",
      ].filter(Boolean).join(" · ");

      const appendGroup = (label, names, className = "") => {
        if (names.length === 0) return null;
        const group = document.createElement("div");
        group.className = "dcui-manager-group";
        if (className) group.classList.add(className);
        group.dataset.managerLabel = label;
        const heading = document.createElement("strong");
        heading.textContent = `${label}:`;
        const value = document.createElement("span");
        value.className = "dcui-manager-value";
        value.textContent = names.join(", ");
        group.append(heading, value);
        line.appendChild(group);
        return { group, value };
      };
      appendGroup("매니저", managers);

      const subManagerGroup = appendGroup("부매니저", subManagers.slice(0, 2), "dcui-submanager-group");
      if (subManagerGroup && subManagers.length > 2) {
        const extraRow = document.createElement("div");
        extraRow.className = "dcui-submanager-extra-row";
        extraRow.hidden = true;
        const extraNames = document.createElement("span");
        extraNames.className = "dcui-submanager-extra";
        extraNames.textContent = subManagers.slice(2).join(", ");
        extraRow.appendChild(extraNames);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "dcui-submanager-toggle";
        toggle.setAttribute("aria-label", `부매니저 ${subManagers.length - 2}명 더 보기`);
        toggle.setAttribute("aria-expanded", "false");
        toggle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="m3 6 5 5 5-5Z"></path></svg>';
        subManagerGroup.group.append(toggle, extraRow);
      }

      if (openingDate && !introText) {
        appendGroup("개설일", [openingDate], "dcui-opening-date-group");
      }

      if (reportButton) {
        const reportRow = document.createElement("div");
        reportRow.className = "dcui-manager-report-row";
        reportRow.dataset.managerLabel = "갤러리 관리 내역";
        reportRow.title = "";
        reportButton.title = "";
        reportRow.appendChild(reportButton);
        line.appendChild(reportRow);
        const nativeOnclick = reportButton.getAttribute("onclick") || "";
        if (/\bget_manage_report\s*\(/.test(nativeOnclick)) {
          AnchoredPopupController.bind({
            trigger: reportButton,
            popupSelector: "#pop_manage_report_list",
            anchor: () => reportButton.closest(".dcui-manager-line") || reportButton,
            popupClass: "dcui-manager-report-popup",
            nativeFunction: "get_manage_report",
            closeSelector: ".poply_whiteclose",
          });
        }
      }

      line.addEventListener("click", (event) => {
        const toggle = event.target.closest?.(".dcui-submanager-toggle");
        if (toggle && line.contains(toggle)) {
          event.preventDefault();
          const extraRow = toggle.closest(".dcui-submanager-group")?.querySelector(".dcui-submanager-extra-row");
          const expanded = toggle.getAttribute("aria-expanded") === "true";
          toggle.setAttribute("aria-expanded", String(!expanded));
          toggle.setAttribute("aria-label", expanded
            ? `부매니저 ${subManagers.length - 2}명 더 보기`
            : "부매니저 접기");
          if (extraRow) extraRow.hidden = expanded;
          return;
        }

      }, true);

      if (galleryIntro) galleryIntro.appendChild(line);
      else pageHead.insertAdjacentElement("afterend", line);
      return line;
    },

    boardTab(label, href, active = false, className = "") {
      const link = document.createElement("a");
      link.className = `dcui-board-tab ${className}`.trim();
      link.href = href;
      link.textContent = label;
      if (active) {
        link.classList.add("dcui-active");
        link.setAttribute("aria-current", "page");
      }
      return link;
    },

    layoutBoardNavigation(nav) {
      const more = nav?.querySelector(":scope > .dcui-board-more");
      const menu = nav?.querySelector(":scope > .dcui-board-more-menu");
      if (!nav || !more || !menu) return;

      const listTabs = nav.closest(".list_array_option");
      listTabs?.style.removeProperty("width");
      nav.style.removeProperty("flex");
      nav.style.removeProperty("width");

      const wasOpen = more.classList.contains("dcui-open");
      const movable = Array.from(nav.querySelectorAll(".dcui-board-tab[data-overflow-order]"))
        .sort((left, right) => Number(left.dataset.overflowOrder) - Number(right.dataset.overflowOrder));
      for (const link of movable) nav.insertBefore(link, more);
      const firstHead = movable[0];
      if (firstHead) {
        const navBox = nav.getBoundingClientRect();
        const firstHeadBox = firstHead.getBoundingClientRect();
        const navBorderLeft = Number.parseFloat(getComputedStyle(nav).borderLeftWidth) || 0;
        menu.style.setProperty(
          "--dcui-board-menu-start",
          `${Math.max(0, firstHeadBox.left - navBox.left - navBorderLeft)}px`,
        );
      }
      more.hidden = true;
      more.classList.remove("dcui-active");

      const firstRowOverflows = () => {
        const navTop = nav.getBoundingClientRect().top;
        const rowItems = Array.from(nav.children)
          .filter((child) => child !== menu && !child.hidden);
        return nav.scrollWidth > nav.clientWidth + 1
          || rowItems.some((item) => item.getBoundingClientRect().top > navTop + 2);
      };

      if (!firstRowOverflows()) {
        more.classList.remove("dcui-open");
        more.querySelector("button")?.setAttribute("aria-expanded", "false");
        return;
      }
      const overflowWidth = nav.getBoundingClientRect().width;
      nav.style.flex = `0 0 ${overflowWidth}px`;
      nav.style.width = `${overflowWidth}px`;
      more.hidden = false;
      for (let index = movable.length - 1; index >= 0 && firstRowOverflows(); index -= 1) {
        menu.prepend(movable[index]);
      }
      nav.style.removeProperty("flex");
      nav.style.removeProperty("width");
      more.classList.toggle("dcui-active", Boolean(menu.querySelector(".dcui-active")));
      more.classList.toggle("dcui-open", wasOpen);
      more.querySelector("button")?.setAttribute("aria-expanded", String(wasOpen));
    },

    bindBoardMore(nav, more) {
      const button = more.querySelector("button");
      const close = () => {
        more.classList.remove("dcui-open");
        button?.setAttribute("aria-expanded", "false");
      };
      button?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (more.hidden) {
          close();
          return;
        }
        const open = more.classList.toggle("dcui-open");
        button.setAttribute("aria-expanded", String(open));
      });
      more.addEventListener("click", (event) => event.stopPropagation());
      document.addEventListener("click", close);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });

      const layout = () => this.layoutBoardNavigation(nav);
      window.requestAnimationFrame(layout);
      window.addEventListener("resize", layout, { passive: true });
      if (typeof ResizeObserver === "function") {
        let observedWidth = nav.getBoundingClientRect().width;
        const observer = new ResizeObserver(([entry]) => {
          const nextWidth = entry?.contentRect.width || nav.getBoundingClientRect().width;
          if (Math.abs(nextWidth - observedWidth) < 0.5) return;
          observedWidth = nextWidth;
          layout();
        });
        observer.observe(nav);
        nav.__dcuiResizeObserver = observer;
      }
    },

    mountBoardNavigation(listTabs) {
      if (!listTabs) return;
      const mountedNav = listTabs.querySelector(".dcui-board-nav");
      if (mountedNav) {
        this.syncSubjectCells(mountedNav);
        return;
      }

      const currentUrl = new URL(location.href);
      const exceptionMode = currentUrl.searchParams.get("exception_mode") || "";
      const searchHead = currentUrl.searchParams.get("search_head");
      const originalTabs = listTabs.querySelector(".array_tab");
      const originalHeads = listTabs.querySelector(".center_box");
      const nav = document.createElement("nav");
      nav.className = "dcui-board-nav";
      nav.setAttribute("aria-label", "갤러리 글 분류");

      const home = this.boardTab(
        "전체글",
        pageContext.urls.list,
        !exceptionMode && searchHead === null,
        "dcui-board-tab-home",
      );
      home.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="M3 10.7 12 3l9 7.7v9.1a1.2 1.2 0 0 1-1.2 1.2h-5.1v-6.2H9.3V21H4.2A1.2 1.2 0 0 1 3 19.8Z"></path>
        </svg>
        <span class="blind">전체글 1페이지</span>
      `;
      nav.appendChild(home);
      const conceptActive = exceptionMode === "recommend";
      if (!pageContext.isRealtimeBest) {
        const conceptTab = this.boardTab(
          "개념글",
          pageContext.urls.concept,
          conceptActive,
          "dcui-board-tab-concept",
        );
        conceptTab.setAttribute("aria-label", "개념글 보기");
        nav.appendChild(conceptTab);
      }

      const overflowLinks = [];
      for (const source of originalHeads?.querySelectorAll("a") || []) {
        const label = cleanText(source.textContent);
        const headValue = source.getAttribute("onclick")?.match(/listSearchHead\((\d+)\)/)?.[1];
        if (!label || headValue === undefined) continue;
        const target = new URL(pageContext.urls.list);
        target.searchParams.set("search_head", headValue);
        overflowLinks.push(this.boardTab(label, target.href, !exceptionMode && searchHead === headValue));
      }

      overflowLinks.push(this.boardTab("공지", pageContext.urls.notice, exceptionMode === "notice"));
      overflowLinks.forEach((link, index) => {
        link.dataset.overflowOrder = String(index);
        nav.appendChild(link);
      });

      const more = document.createElement("div");
      more.className = "dcui-board-more";
      more.hidden = true;
      more.innerHTML = `
        <button type="button" class="dcui-board-more-button" aria-label="말머리 더보기" aria-expanded="false">
          <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="m3 6 5 5 5-5Z"></path></svg>
        </button>
      `;
      nav.appendChild(more);
      const moreMenu = document.createElement("div");
      moreMenu.className = "dcui-board-more-menu";
      moreMenu.setAttribute("role", "menu");
      nav.appendChild(moreMenu);
      listTabs.prepend(nav);
      originalTabs?.classList.add("dcui-board-nav-source");
      originalHeads?.classList.add("dcui-board-nav-source");
      this.syncSubjectCells(nav);
      this.bindBoardMore(nav, more);
    },

    subjectTargets(root = document, nav = root.querySelector?.(".dcui-board-nav")) {
      const targets = new Map();
      for (const link of nav?.querySelectorAll(".dcui-board-tab") || []) {
        const label = cleanText(link.textContent);
        if (label) targets.set(label, link.href);
      }
      for (const source of root.querySelectorAll?.(".list_array_option .center_box a") || []) {
        const label = cleanText(source.textContent);
        const headValue = source.getAttribute("onclick")?.match(/listSearchHead\((\d+)\)/)?.[1];
        if (!label || headValue === undefined) continue;
        const target = new URL(pageContext.urls.list);
        target.searchParams.set("search_head", headValue);
        targets.set(label, target.href);
      }
      targets.set("공지", pageContext.urls.notice);
      return targets;
    },

    subjectTargetCacheKey() {
      return `dcui:subject-targets:${pageContext.galleryKey}`;
    },

    readSubjectTargetCache() {
      const cached = GM_getValue(this.subjectTargetCacheKey(), null);
      if (!cached || !Array.isArray(cached.entries)) {
        return { targets: new Map(), fresh: false };
      }
      const entries = cached.entries.filter((entry) => (
        Array.isArray(entry)
        && entry.length === 2
        && typeof entry[0] === "string"
        && typeof entry[1] === "string"
      ));
      const savedAt = Number(cached.savedAt) || 0;
      return {
        targets: new Map(entries),
        fresh: Date.now() - savedAt <= SUBJECT_TARGET_CACHE_TTL_MS,
      };
    },

    cacheSubjectTargets(targets) {
      const entries = Array.from(targets).filter(([label, href]) => label && href);
      const hasSearchHead = entries.some(([, href]) => {
        try {
          return new URL(href, location.href).searchParams.has("search_head");
        } catch (_error) {
          return false;
        }
      });
      if (!hasSearchHead) return false;
      GM_setValue(this.subjectTargetCacheKey(), {
        savedAt: Date.now(),
        entries,
      });
      return true;
    },

    loadSubjectTargets() {
      if (!subjectTargetPromise) {
        subjectTargetPromise = AutomatedRequestCoordinator.run(async (signal) => {
          const response = await fetch(pageContext.urls.list, {
            credentials: "include",
            cache: "no-store",
            signal,
          });
          if (!response.ok) throw new Error(`말머리 목록 요청 실패: ${response.status}`);
          const html = AutomatedRequestCoordinator.requireNonEmpty(await response.text());
          const targets = this.subjectTargets(new DOMParser().parseFromString(html, "text/html"));
          this.cacheSubjectTargets(targets);
          return targets;
        });
      }
      return subjectTargetPromise;
    },

    linkSubjectCells(targets) {
      for (const cell of document.querySelectorAll("table.dcui-list-table tbody tr.ub-content .dcui-tab-cell")) {
        const existing = cell.querySelector(":scope > .dcui-subject-filter-link");
        if (existing?.shadowRoot) continue;
        const label = cleanText(cell.textContent);
        const targetHref = targets.get(label);
        if (!targetHref) continue;

        // Refresher reads a row's first light-DOM anchor as its post URL.
        // Keep our generated filter link separate while retaining the native
        // cell content through a slot and a real, keyboard-accessible anchor.
        const host = existing || document.createElement("span");
        host.className = "dcui-subject-filter-link";
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = `
          a { display: block; overflow: hidden; color: inherit; font: inherit;
            text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
          a:hover, a:focus-visible { color: var(--dcui-color-link); text-decoration: underline; }
          a:focus-visible { outline: 2px solid var(--dcui-color-accent); outline-offset: -2px; }
        `;
        const link = document.createElement("a");
        link.href = targetHref;
        link.setAttribute("aria-label", `${label} 말머리 글만 보기`);
        link.appendChild(document.createElement("slot"));
        for (const type of ["click", "auxclick", "contextmenu"]) {
          link.addEventListener(type, (event) => {
            link.href = galleryBoardHref(link.href);
            // A filter click must not open the row's Refresher preview.
            event.stopPropagation();
          });
        }
        shadow.append(style, link);
        if (!existing) {
          while (cell.firstChild) host.appendChild(cell.firstChild);
          cell.appendChild(host);
        }
      }
    },

    syncSubjectCells(nav = null) {
      const localTargets = this.subjectTargets(document, nav || undefined);
      const cached = this.readSubjectTargetCache();
      const knownTargets = new Map([...cached.targets, ...localTargets]);
      this.linkSubjectCells(knownTargets);
      const localTargetsAreComplete = this.cacheSubjectTargets(localTargets);
      const hasFreshTargets = cached.fresh || localTargetsAreComplete;
      const hasUnlinkedSupportedCell = Array.from(document.querySelectorAll(
        "table.dcui-list-table tbody tr.ub-content .dcui-tab-cell:not(:has(> .dcui-subject-filter-link))",
      )).some((cell) => !["", "설문", "AD"].includes(cleanText(cell.textContent)));
      const needsRemoteTargets = !hasFreshTargets && hasUnlinkedSupportedCell;
      const needsFreshViewTargets = pageContext.pageType === "view" && !hasFreshTargets;
      if (!needsRemoteTargets && !needsFreshViewTargets) return;

      this.loadSubjectTargets().then((remoteTargets) => {
        const mergedTargets = new Map([...remoteTargets, ...localTargets]);
        this.linkSubjectCells(mergedTargets);
      }).catch((error) => {
        if (error?.name === "EmptyAutomatedResponseError") {
          console.warn("[DC 자동 요청] 빈 응답으로 모든 자동 요청을 중지했습니다.");
        } else if (error?.name !== "AbortError") {
          console.debug("[DC 말머리 매핑] 목록 확인 실패", error);
        }
        // 원본 목록 요청이 실패하면 이미 확인된 로컬 말머리 링크만 유지한다.
      });
    },

    syncGalleryHeader() {
      const listTabs = document.querySelector(".list_array_option");
      const pageHead = document.querySelector(".page_head");
      if (pageContext.pageType !== "list" || !listTabs || !pageHead || !listTabs.parentNode) return false;

      const tabsParent = listTabs.parentNode;
      const galleryIntro = this.mountGalleryIntro(pageHead);
      this.bindRelationPopup(pageHead);
      const managerLine = this.mountManagerLine(pageHead);
      const galleryCover = document.querySelector(".dcui-gallery-cover");
      const headerRoot = galleryCover || galleryIntro || pageHead;
      const featuredPosts = FeaturedPostsView.mount(pageContext);
      const leftContent = DcAdapter.leftContent();
      if (featuredPosts && leftContent?.firstElementChild !== featuredPosts) {
        leftContent?.prepend(featuredPosts);
      }
      if (headerRoot.parentNode !== tabsParent
        || !(headerRoot.compareDocumentPosition(listTabs) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        tabsParent.insertBefore(headerRoot, listTabs);
      }
      if (galleryCover && galleryIntro && galleryCover.nextElementSibling !== galleryIntro) {
        galleryCover.insertAdjacentElement("afterend", galleryIntro);
      }
      if (!galleryIntro && managerLine && pageHead.nextElementSibling !== managerLine) {
        pageHead.insertAdjacentElement("afterend", managerLine);
      }
      this.mountBoardNavigation(listTabs);
      const headerTail = galleryIntro || managerLine || pageHead;
      if (headerTail.nextElementSibling !== listTabs) {
        headerTail.insertAdjacentElement("afterend", listTabs);
      }
      return Boolean(managerLine);
    },

    watchGalleryHeader() {
      if (document.documentElement.dataset.dcuiHeaderWatch === "true") return;
      document.documentElement.dataset.dcuiHeaderWatch = "true";

      const sync = () => {
        this.syncGalleryHeader();
        this.mountBottomMenu();
      };
      window.setTimeout(sync, 300);
      window.setTimeout(sync, 1200);
      window.setTimeout(sync, 3000);

      const leftContent = DcAdapter.leftContent();
      if (!leftContent || typeof MutationObserver !== "function") return;
      let frame = 0;
      const observer = new MutationObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(sync);
      });
      observer.observe(leftContent, { childList: true, subtree: true });
      window.setTimeout(() => observer.disconnect(), 5000);
    },

    decorateControls() {
      for (const button of document.querySelectorAll(".array_tab button")) {
        const label = cleanText(button.textContent);
        if (label === "전체글") button.textContent = "전체글";
        if (label === "개념글") button.textContent = "개념글";
      }

      for (const button of document.querySelectorAll(".list_bottom_btnbox button, .view_bottom_btnbox button")) {
        const label = cleanText(button.textContent);
        if (label === "전체글" || label === "목록으로") button.textContent = "전체글";
        if (label === "개념글") button.textContent = "개념글";
      }

      this.syncGalleryHeader();
      this.watchGalleryHeader();
      this.mountListSizeControl();
      this.mountBottomMenu();

      if (pageContext.pageType === "list") this.alignSidebarToList();
    },

    mountBottomMenu() {
      const listArticle = DcAdapter.listRoot()?.closest("article");
      const paging = listArticle?.querySelector(":scope > .bottom_paging_wrap");
      if (!paging?.parentNode) return null;
      const existing = listArticle.querySelector(":scope > .dcui-fm-bottom-menu");
      if (existing) {
        if (existing.nextElementSibling !== paging) paging.parentNode.insertBefore(existing, paging);
        return existing;
      }

      const searchForm = listArticle.querySelector(":scope > form .buttom_search_wrap")?.closest("form");
      const bottomButtons = [...listArticle.querySelectorAll(":scope > .list_bottom_btnbox button")];
      const conceptButton = bottomButtons.find((button) => cleanText(button.textContent) === "개념글");
      const conceptActive = new URL(location.href).searchParams.get("exception_mode") === "recommend";
      const writeButton = listArticle.querySelector(":scope > .list_bottom_btnbox #btn_write")
        || bottomButtons.find((button) => cleanText(button.textContent) === "글쓰기");
      if (!searchForm && !conceptButton && !writeButton) return null;

      const menu = document.createElement("div");
      menu.className = "dcui-fm-bottom-menu";
      if (searchForm) {
        const searchWrap = searchForm.querySelector(".buttom_search_wrap");
        const searchInput = searchWrap?.querySelector(".bottom_search");
        const searchType = searchWrap?.querySelector(".bottom_array");
        const searchTypeArea = searchType?.querySelector(".select_area");
        searchInput?.classList.add("dcui-control-frame");
        searchTypeArea?.classList.add("dcui-control-frame");
        searchTypeArea?.querySelector(":scope > .inner")?.classList.add("dcui-control-addon");
        if (searchWrap && searchInput && searchType) searchWrap.append(searchInput, searchType);
        menu.appendChild(searchForm);
      }
      const actions = document.createElement("div");
      actions.className = "dcui-fm-bottom-actions";
      if (conceptButton) {
        let conceptControl = conceptButton;
        if (conceptActive) {
          conceptControl = document.createElement("a");
          conceptControl.href = pageContext.urls.list;
          conceptControl.className = "dcui-fm-bottom-button dcui-fm-concept-button dcui-active";
          conceptControl.textContent = "개념글";
          conceptControl.dataset.dcuiToggleUrl = pageContext.urls.list;
          conceptControl.setAttribute("aria-current", "page");
          conceptControl.setAttribute("aria-label", "개념글, 전체글 목록으로 돌아가기");
        } else {
          conceptControl.classList.add("dcui-fm-bottom-button", "dcui-fm-concept-button");
          conceptButton.setAttribute("aria-pressed", "false");
          conceptButton.setAttribute("aria-label", "개념글 보기");
        }
        actions.appendChild(conceptControl);
      }
      if (writeButton) {
        writeButton.classList.add("dcui-fm-bottom-button", "dcui-fm-write-button");
        actions.appendChild(writeButton);
      }
      if (actions.childElementCount > 0) menu.appendChild(actions);
      paging.parentNode.insertBefore(menu, paging);
      return menu;
    },

    mountListSizeControl() {
      const control = document.querySelector(".list_array_option .array_num");
      const select = control?.querySelector("#sarray_numbers");
      const currentLink = control?.querySelector(".select_area > a");
      const optionLinks = [...(control?.querySelectorAll("#listSizeLayer a") || [])];
      if (!control || !select || !currentLink || optionLinks.length === 0) return;

      control.classList.add("dcui-list-size-control");
      control.closest(".right_box")?.querySelector(".switch_btnbox .btn_write")
        ?.classList.add("dcui-top-write-button");
      const currentSize = cleanText(currentLink.textContent).match(/(?:30|50|100)/)?.[0] || select.value || "30";
      select.value = currentSize;
      currentLink.setAttribute("aria-haspopup", "listbox");
      currentLink.setAttribute("aria-label", `페이지당 게시글 ${currentSize}개`);
      control.querySelector("#listSizeLayer")?.setAttribute("role", "listbox");
      optionLinks.forEach((link) => {
        const size = cleanText(link.textContent).match(/(?:30|50|100)/)?.[0];
        if (!size) return;
        link.setAttribute("role", "option");
        link.setAttribute("aria-selected", String(size === currentSize));
      });

      if (!control.dataset.dcuiListSizePreferenceBound) {
        control.dataset.dcuiListSizePreferenceBound = "true";
        control.addEventListener("click", (event) => {
          const option = event.target.closest?.("#listSizeLayer a");
          if (!option || !control.contains(option)) return;
          const size = cleanText(option.textContent).match(/(?:30|50|100)/)?.[0];
          if (size) ListSizeConfig.set(size);
        }, true);
      }
    },

    alignSidebarToList() {
      const sidebar = document.getElementById("dcui-sidebar");
      if (!sidebar) return;
      sidebar.style.marginTop = "0px";
    },

    injectStyle() {
      if (document.getElementById("dcui-list-style")) return;

      const style = document.createElement("style");
      style.id = "dcui-list-style";
      style.textContent = `
        html.dcui-enabled .list_array_option {
          display: flex !important;
          align-items: flex-end;
          justify-content: space-between;
          min-height: 38px;
          margin-top: 12px;
          border-bottom: 0;
        }
        html.dcui-enabled .list_array_option::after {
          display: none !important;
        }
        html.dcui-enabled .array_tab {
          display: inline-flex;
          flex: 0 0 auto;
          align-items: flex-end;
          gap: 2px;
          width: auto !important;
          height: 38px;
        }
        html.dcui-enabled .array_tab button {
          min-width: 76px;
          height: 34px;
          border: 1px solid var(--dcui-color-border);
          border-bottom: 0;
          border-radius: 0;
          background: var(--dcui-color-surface);
          color: var(--dcui-color-text-soft);
          font-size: 12px;
          font-weight: 700;
        }
        html.dcui-enabled .array_tab button:hover {
          border-color: var(--dcui-control-border-hover);
          color: var(--dcui-color-link);
        }
        html.dcui-enabled .array_tab button.on {
          border-color: var(--dcui-color-nav-light);
          background: var(--dcui-color-nav-light);
          color: var(--dcui-color-on-accent);
        }
        html.dcui-enabled .list_array_option .right_box {
          float: none;
          width: auto;
          padding-top: 4px;
        }
        html.dcui-enabled .list_array_option .output_array {
          display: flex !important;
          align-items: center;
          gap: 6px;
          padding-top: 0;
        }
        html.dcui-enabled .list_array_option .select_area,
        html.dcui-enabled .list_array_option .btn_write {
          height: 29px;
          border: 1px solid var(--dcui-color-border);
          border-radius: 0;
          background: var(--dcui-color-surface);
          color: var(--dcui-color-text-soft);
          line-height: 27px;
        }
        html.dcui-enabled .list_array_option .btn_write {
          display: inline-block;
          min-width: 64px;
          padding: 0 10px;
          border-color: var(--dcui-color-nav-light);
          background: var(--dcui-color-nav-light);
          color: var(--dcui-color-on-accent);
          font-weight: 700;
          text-align: center;
        }
        html.dcui-enabled .dcui-list {
          border-top: 2px solid var(--dcui-color-nav-light);
        }
        html.dcui-enabled table.dcui-list-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          color: var(--dcui-color-text);
          font-family: var(--dcui-font);
        }
        html.dcui-enabled table.dcui-list-table thead th {
          height: 34px;
          border-bottom: 1px solid var(--dcui-color-border-strong);
          background: var(--dcui-color-subtle);
          color: var(--dcui-color-text-soft);
          font-size: 11px;
          font-weight: 700;
          text-align: center;
        }
        html.dcui-enabled table.dcui-list-table tbody tr {
          transition: background-color 100ms ease;
        }
        html.dcui-enabled table.dcui-list-table tbody tr:hover {
          background: var(--dcui-color-surface-hover);
        }
        html.dcui-enabled table.dcui-list-table tbody td {
          height: 34px;
          padding-top: 0;
          padding-bottom: 0;
          border-bottom: 1px solid var(--dcui-color-border-soft);
          color: var(--dcui-color-text);
          font-size: 12px;
          line-height: 34px;
        }
        html.dcui-enabled table.dcui-list-table .gall_num,
        html.dcui-enabled table.dcui-list-table .gall_date,
        html.dcui-enabled table.dcui-list-table .gall_count,
        html.dcui-enabled table.dcui-list-table .gall_recommend {
          color: var(--dcui-color-muted);
          font-size: 11px;
          text-align: center;
        }
        html.dcui-enabled table.dcui-list-table .gall_tit {
          padding-left: 8px;
        }
        html.dcui-enabled table.dcui-list-table tbody tr.ub-content.block-disable {
          display: none !important;
        }
        html.dcui-enabled table.dcui-list-table .gall_tit > a:not(.reply_numbox) {
          color: var(--dcui-color-text-strong);
          text-decoration: none;
        }
        html.dcui-enabled table.dcui-list-table .gall_tit > a:not(.reply_numbox):visited {
          color: var(--dcui-color-faint);
        }
        html.dcui-enabled table.dcui-list-table .gall_tit > a:not(.reply_numbox):hover {
          color: var(--dcui-color-link);
          text-decoration: underline;
        }
        html.dcui-enabled table.dcui-list-table .reply_numbox,
        html.dcui-enabled table.dcui-list-table .reply_num {
          color: var(--dcui-color-link);
          font-size: 11px;
          font-weight: 400;
        }
        html.dcui-enabled table.dcui-list-table .gall_writer {
          overflow: hidden;
          padding: 0 6px;
          text-align: left;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcui-enabled table.dcui-list-table .gall_writer[user_name="운영자"] {
          text-align: center;
        }
        html.dcui-enabled table.dcui-list-table .gall_writer .addbox:has(> .dcui-user-identifier) {
          display: inline-flex;
          align-items: center;
          width: 100%;
          min-width: 0;
          vertical-align: middle;
        }
        html.dcui-enabled table.dcui-list-table .gall_writer .addbox:has(> .dcui-user-identifier) > .nickname,
        html.dcui-enabled table.dcui-list-table .gall_writer .addbox:has(> .dcui-user-identifier) > .writer_nikcon {
          flex: 0 0 auto;
          max-width: none;
        }
        html.dcui-enabled table.dcui-list-table .gall_writer .dcui-user-identifier {
          flex: 0 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-left: 3px;
          color: var(--dcui-color-faint);
          font-size: 9px;
          font-weight: 400;
        }
        html.dcui-enabled table.dcui-list-table .gall_writer:has(.user_data.add) {
          overflow: visible;
        }
        html.dcui-enabled table.dcui-list-table tr.dcui-row-notice {
          background: var(--dcui-color-surface-notice);
        }
        html.dcui-enabled table.dcui-list-table tr.dcui-row-notice .gall_num,
        html.dcui-enabled table.dcui-list-table tr.dcui-row-notice .gall_tit > a {
          color: var(--dcui-color-link);
          font-weight: 700;
        }
        html.dcui-enabled table.dcui-list-table tr.dcui-row-survey {
          background: var(--dcui-color-surface-survey);
        }
        html.dcui-enabled table.dcui-list-table tr.dcui-row-ad {
          background: var(--dcui-color-surface-ad);
        }
        html.dcui-enabled .list_bottom_btnbox {
          min-height: 42px;
          padding-top: 10px;
        }
        html.dcui-enabled .list_bottom_btnbox button {
          height: 30px;
          border: 1px solid var(--dcui-color-border);
          border-radius: 0;
          background: var(--dcui-color-surface);
          color: var(--dcui-color-text-soft);
          line-height: 28px;
        }
        html.dcui-enabled .list_bottom_btnbox .btn_blue,
        html.dcui-enabled .list_bottom_btnbox #btn_write {
          border-color: var(--dcui-color-nav-light);
          background: var(--dcui-color-nav-light);
          color: var(--dcui-color-on-accent);
        }
        html.dcui-enabled .bottom_paging_wrap {
          display: flex !important;
          align-items: flex-start;
          justify-content: center;
          gap: 10px;
          min-height: 48px;
          margin-top: 4px;
          padding: 9px 10px 0;
          border-top: 1px solid var(--dcui-color-border);
        }
        html.dcui-enabled .bottom_paging_wrap::after {
          display: none !important;
        }
        html.dcui-enabled .bottom_paging_box {
          display: flex;
          flex: 0 1 auto;
          box-sizing: border-box;
          height: 26px !important;
          min-height: 0 !important;
          align-items: center;
          justify-content: center;
          gap: 2px;
          width: auto !important;
          padding: 0 !important;
        }
        html.dcui-enabled .bottom_paging_box > a,
        html.dcui-enabled .bottom_paging_box > em {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          min-width: 27px;
          width: 27px;
          height: 27px;
          margin: 0 !important;
          padding: 0 !important;
          border: 1px solid transparent;
          color: var(--dcui-color-text-soft);
          font-style: normal;
          line-height: 25px;
          text-decoration: none;
        }
        html.dcui-enabled .bottom_paging_box > a:hover {
          border-color: var(--dcui-color-border);
          color: var(--dcui-color-link);
        }
        html.dcui-enabled .bottom_paging_box > em {
          border-color: var(--dcui-color-nav-light);
          background: var(--dcui-color-nav-light);
          color: var(--dcui-color-on-accent);
          font-weight: 700;
        }
        html.dcui-enabled .bottom_paging_box .page_first,
        html.dcui-enabled .bottom_paging_box .page_prev,
        html.dcui-enabled .bottom_paging_box .page_next,
        html.dcui-enabled .bottom_paging_box .page_end {
          width: 42px;
          min-width: 42px;
          overflow: visible;
          background-image: none !important;
          font-size: 11px !important;
          text-indent: 0 !important;
        }
        html.dcui-enabled .bottom_movebox {
          position: static;
          flex: 0 0 auto;
          width: auto;
          margin: 0;
        }
        html.dcui-enabled .buttom_search_wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100% !important;
          height: 32px;
          margin: 14px 0 28px;
        }
        html.dcui-enabled .buttom_search_wrap .bottom_array {
          float: none;
          width: 125px;
          height: 32px;
        }
        html.dcui-enabled .buttom_search_wrap .select_area {
          height: 32px;
          margin: 0 !important;
          border: 1px solid var(--dcui-color-border);
          border-radius: 0;
          background: var(--dcui-color-surface);
          color: var(--dcui-color-text-soft);
          line-height: 30px;
        }
        html.dcui-enabled .buttom_search_wrap .bottom_search {
          position: static !important;
          float: none;
          width: 320px;
          height: 32px;
          margin: 0 0 0 5px !important;
          border: 1px solid var(--dcui-color-nav-light);
          background: var(--dcui-color-surface);
        }
        html.dcui-enabled .buttom_search_wrap .bottom_search .inner_search {
          float: left;
          width: 281px;
          height: 30px;
          margin: 0 !important;
        }
        html.dcui-enabled .buttom_search_wrap .bottom_search .in_keyword {
          width: 281px;
          height: 30px;
        }
        html.dcui-enabled .buttom_search_wrap .bottom_search .bnt_search {
          float: right;
          width: 37px;
          height: 30px;
          margin: 0 !important;
          background-color: var(--dcui-color-nav-light);
        }
        html.dcui-enabled .page_head {
          position: relative;
          min-height: 42px;
          margin-bottom: 0;
          border-bottom: 0;
        }
        html.dcui-enabled .page_head h2 {
          position: relative;
          margin: 4px 0 0;
          padding: 0 0 0 24px;
          font-size: 20px;
          line-height: 26px;
        }
        html.dcui-enabled .page_head h2::before {
          position: absolute;
          top: 0;
          left: 0;
          width: 14px;
          height: 26px;
          border-radius: 2px;
          background: var(--dcui-color-text-soft);
          content: "";
        }
        html.dcui-enabled .page_head h2 a {
          color: var(--dcui-color-text-soft);
          font-size: 20px;
          line-height: 26px;
          text-decoration: none;
        }
        html.dcui-enabled .page_head .pagehead_titicon {
          display: none !important;
        }
        html.dcui-enabled .dcui-gallery-intro > .page_head > .fl {
          display: flex;
          float: none;
          min-width: 0;
          flex: 1 1 auto;
          align-items: center;
        }
        html.dcui-enabled .dcui-gallery-intro > .page_head h2 {
          float: none !important;
        }
        html.dcui-enabled .dcui-gallery-intro > .page_head .favorite {
          display: inline-flex !important;
          float: none !important;
          align-items: center;
          margin: 3px 0 0 8px !important;
        }
        html.dcui-enabled .dcui-gallery-intro > .page_head .favorite button {
          display: inline-flex;
          width: 28px !important;
          height: 29px !important;
          align-items: center;
          justify-content: center;
        }
        html.dcui-enabled .dcui-gallery-intro > .page_head .favorite button .icon_favorite {
          margin: 0 !important;
          transform: scale(1.2);
          transform-origin: center;
        }
        html.dcui-enabled.dcui-page-view .page_head .gall_issuebox > button[onclick*="gt_toggle_issue("] {
          display: none !important;
        }
        html.dcui-enabled .page_head .gall_issuebox .issue_gallinfo,
        html.dcui-enabled .page_head .gall_issuebox > .bundle {
          display: none !important;
        }
        html.dcui-enabled .dcui-gallery-intro > .page_head .gall_issuebox {
          display: flex !important;
          float: none !important;
          flex: 0 0 auto;
          align-items: center;
          margin-left: 10px;
        }
        html.dcui-enabled .dcui-gallery-intro > .page_head .gall_issuebox .relate {
          display: inline-flex !important;
          height: 24px;
          align-items: center;
          border: 0;
          padding: 0;
          background: transparent;
          color: var(--dcui-color-muted);
          font: 11px/24px var(--dcui-font);
          cursor: pointer;
        }
        html.dcui-enabled .dcui-gallery-intro > .page_head .gall_issuebox .relate:hover {
          color: var(--dcui-color-link);
          text-decoration: underline;
        }
        html.dcui-enabled .page_head .adr_copy,
        html.dcui-enabled .page_head .gall_useinfo {
          display: none !important;
        }
        html.dcui-enabled .issue_contentbox,
        html.dcui-enabled .minor_intro_box,
        html.dcui-enabled .mini_intro_box,
        html.dcui-enabled .person_intro_box {
          display: none !important;
        }
        html.dcui-enabled .issue_wrap {
          border-top: 0 !important;
        }
        html.dcui-enabled .dcui-gallery-intro {
          position: relative;
          z-index: 2;
          display: flex;
          box-sizing: border-box;
          width: 100%;
          min-height: 0;
          align-items: center;
          flex-direction: column;
          gap: 3px;
          margin: 0 0 8px;
          padding: 0 20px 5px;
          border: 0;
          border-radius: 0;
          background: transparent;
          color: var(--dcui-color-text-soft);
        }
        html.dcui-enabled .dcui-gallery-cover {
          position: relative;
          z-index: 1;
          display: flex;
          width: fit-content;
          max-width: 100%;
          align-items: center;
          justify-content: center;
          margin: -4px auto 9px;
          background: var(--dcui-color-surface);
        }
        html.dcui-enabled.dcui-gallery-cover-hidden .dcui-gallery-cover {
          display: none !important;
        }
        html.dcui-enabled .dcui-gallery-cover > img {
          display: block;
          width: auto;
          max-width: 100%;
          height: auto;
          max-height: 450px;
          object-fit: contain;
        }
        html.dcui-enabled .dcui-gallery-cover > span {
          display: block;
          width: 100%;
          aspect-ratio: 16 / 9;
          max-height: 450px;
          background-position: center;
          background-repeat: no-repeat;
          background-size: contain;
        }
        html.dcui-enabled .dcui-gallery-intro-text {
          display: flex;
          box-sizing: border-box;
          width: min(800px, 100%);
          min-width: 0;
          align-items: center;
          flex-direction: row;
          gap: 10px;
          padding: 0 2px;
        }
        html.dcui-enabled .dcui-gallery-intro > .page_head {
          display: flex;
          box-sizing: border-box;
          width: min(800px, 100%);
          min-height: 34px;
          align-items: center;
          justify-content: space-between;
          margin: 0;
          padding: 0 2px;
          border: 0;
        }
        html.dcui-enabled .dcui-gallery-intro > .page_head h2 {
          margin-top: 2px;
        }
        html.dcui-enabled .dcui-gallery-meta {
          display: flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 12px;
          min-height: 16px;
        }
        html.dcui-enabled .dcui-gallery-rank,
        html.dcui-enabled .dcui-gallery-members {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: var(--dcui-color-nav);
          font-size: 12px;
        }
        html.dcui-enabled .dcui-gallery-rank-icon {
          display: inline-block;
          flex: 0 0 auto;
          float: none !important;
          margin: 0 !important;
        }
        html.dcui-enabled .dcui-gallery-rank-icon-fallback {
          color: #e64b45;
          font-size: 9px;
        }
        html.dcui-enabled .dcui-gallery-rank strong,
        html.dcui-enabled .dcui-gallery-members strong {
          font-weight: 700;
        }
        html.dcui-enabled .dcui-gallery-members {
          float: none !important;
          margin: 0 !important;
          color: var(--dcui-color-muted);
        }
        html.dcui-enabled .dcui-gallery-join {
          position: relative;
          display: inline-flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 6px;
        }
        html.dcui-enabled .dcui-gallery-join > .box {
          display: inline-flex;
          float: none !important;
          align-items: center;
          margin: 0 !important;
        }
        html.dcui-enabled .dcui-gallery-join .smallestgag {
          float: none !important;
          margin: 0 !important;
        }
        html.dcui-enabled .dcui-gallery-join > .txt.font_grey {
          display: inline-flex;
          align-items: center;
          margin: 0;
          font-size: 12px;
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-gallery-members-icon {
          position: relative;
          display: inline-block;
          width: 12px;
          height: 12px;
        }
        html.dcui-enabled .dcui-gallery-members-icon::before {
          position: absolute;
          top: 0;
          left: 4px;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--dcui-color-muted);
          content: "";
        }
        html.dcui-enabled .dcui-gallery-members-icon::after {
          position: absolute;
          bottom: 0;
          left: 2px;
          width: 9px;
          height: 6px;
          border-radius: 5px 5px 2px 2px;
          background: var(--dcui-color-muted);
          content: "";
        }
        html.dcui-enabled .dcui-gallery-intro-text p {
          flex: 1 1 auto;
          min-width: 0;
          margin: 0;
          overflow: hidden;
          color: var(--dcui-color-text-soft);
          font-size: 12px;
          line-height: 18px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-opening-date {
          flex: 0 0 auto;
          margin-left: auto;
          color: var(--dcui-color-muted);
          font-size: 11px;
          line-height: 18px;
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-opening-date strong {
          color: var(--dcui-color-muted);
          font-weight: 400;
        }
        html.dcui-enabled .dcui-manager-line {
          position: relative;
          z-index: 3;
          display: flex;
          box-sizing: border-box;
          width: 100%;
          min-height: 20px;
          margin: -6px 0 7px;
          padding: 0 20px;
          overflow: visible;
          border: 0;
          background: transparent;
          color: var(--dcui-color-muted);
          font-size: 11px;
          line-height: 17px;
          align-items: flex-start;
          gap: 14px;
        }
        html.dcui-enabled .dcui-gallery-intro + .dcui-manager-line {
          margin-top: 0;
        }
        html.dcui-enabled .dcui-gallery-intro > .dcui-manager-line {
          width: min(800px, 100%);
          min-height: 17px;
          margin: 0;
          padding: 0 2px 2px;
        }
        html.dcui-enabled .dcui-manager-group {
          display: flex;
          min-width: 0;
          align-items: flex-start;
        }
        html.dcui-enabled .dcui-submanager-group {
          display: grid;
          flex: 1 1 0;
          grid-template-columns: max-content max-content 17px minmax(0, 1fr);
          grid-template-rows: 17px auto;
          align-items: start;
          justify-content: start;
        }
        html.dcui-enabled .dcui-manager-group:not(.dcui-submanager-group) {
          flex: 0 0 auto;
        }
        html.dcui-enabled .dcui-manager-group:not(.dcui-submanager-group) .dcui-manager-value {
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-manager-group strong {
          display: block !important;
          flex: 0 0 auto;
          width: auto !important;
          margin-right: 4px;
          color: var(--dcui-color-muted);
          font-weight: 400;
          white-space: nowrap !important;
        }
        html.dcui-enabled .dcui-manager-value {
          display: inline;
          min-width: 0;
          color: var(--dcui-color-link);
          white-space: normal;
        }
        html.dcui-enabled .dcui-manager-value[hidden] {
          display: none !important;
        }
        html.dcui-enabled .dcui-submanager-toggle,
        html.dcui-enabled .dcui-manager-report-row .btn_mngadmin_report {
          display: inline-block;
          width: auto;
          height: 17px;
          margin: 0;
          padding: 0;
          border: 0;
          background: transparent;
          color: var(--dcui-color-link) !important;
          font: 11px/17px var(--dcui-font);
          vertical-align: top;
          cursor: pointer;
        }
        html.dcui-enabled .dcui-submanager-toggle {
          grid-column: 3;
          grid-row: 1;
          width: 17px;
          margin-left: 3px;
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-submanager-toggle svg {
          display: block;
          width: 12px;
          height: 12px;
          margin: 2px auto;
          fill: currentColor;
          transition: transform 0.15s ease;
        }
        html.dcui-enabled .dcui-submanager-toggle[aria-expanded="true"] svg {
          transform: rotate(180deg);
        }
        html.dcui-enabled .dcui-submanager-extra-row {
          grid-column: 2 / -1;
          grid-row: 2;
          min-width: 0;
          padding-top: 1px;
          color: var(--dcui-color-link);
          line-height: 17px;
          overflow-wrap: anywhere;
        }
        html.dcui-enabled .dcui-submanager-extra-row[hidden] {
          display: none !important;
        }
        html.dcui-enabled .dcui-manager-report-row {
          flex: 0 0 auto;
          min-height: 17px;
          margin-left: auto;
          padding: 0;
        }
        html.dcui-enabled .dcui-manager-report-row .btn_mngadmin_report:hover,
        html.dcui-enabled .dcui-submanager-toggle:hover {
          text-decoration: underline;
        }
        html.dcui-enabled .dcui-manager-report-row .btn_mngadmin_report[aria-busy="true"],
        html.dcui-enabled .dcui-gallery-intro .gall_issuebox .relate[aria-busy="true"] {
          opacity: 0.55;
          cursor: progress;
        }
        html.dcui-enabled #container > .left_content {
          position: relative;
        }
        html.dcui-enabled.dcui-relation-popup-opening #relation_popup:not(.dcui-anchored-popup) {
          visibility: hidden !important;
        }
        html.dcui-enabled #container > .left_content > .dcui-anchored-popup {
          background-color: var(--dcui-color-surface) !important;
          color: var(--dcui-color-text);
          position: absolute !important;
          top: var(--dcui-anchored-popup-top, 0) !important;
          right: var(--dcui-anchored-popup-right, 0) !important;
          bottom: auto !important;
          left: auto !important;
          z-index: 10020 !important;
          box-sizing: border-box;
          max-width: 100% !important;
          max-height: none !important;
          margin: 0 !important;
          transform: none !important;
        }
        html.dcui-enabled .list_array_option {
          position: relative;
          display: flex !important;
          box-sizing: border-box;
          width: 100%;
          min-height: 37px;
          height: auto !important;
          align-items: flex-start;
          margin: 0 0 8px;
          padding: 0;
          column-gap: 8px;
          border: 0;
          border-radius: 0;
          background: transparent;
          box-shadow: none;
          overflow: visible;
        }
        html.dcui-enabled .list_array_option::before {
          display: none;
          content: none;
        }
        html.dcui-enabled .list_array_option .dcui-board-nav-source {
          display: none !important;
        }
        html.dcui-enabled .dcui-board-nav {
          position: relative;
          z-index: 5;
          display: flex;
          flex: 0 1 auto;
          box-sizing: border-box;
          width: auto;
          max-width: calc(100% - 159px);
          min-width: 0;
          align-items: center;
          flex-wrap: wrap;
          gap: 0;
          min-height: 37px;
          height: 37px;
          border: 1px solid var(--dcui-color-border);
          border-radius: 2px;
          background: var(--dcui-color-surface);
          box-shadow: 0 1px 1px rgb(0 0 0 / 8%);
          overflow: visible;
        }
        html.dcui-enabled .dcui-board-tab {
          display: inline-flex;
          flex: 0 0 auto;
          min-width: 0;
          height: 35px;
          align-items: center;
          justify-content: center;
          margin: 0;
          padding: 0 12px;
          border: 0;
          border-right: 1px solid var(--dcui-color-border-soft);
          border-radius: 0;
          background: transparent;
          color: var(--dcui-color-muted);
          font-size: 11px;
          font-weight: 700;
          line-height: 35px;
          text-decoration: none;
        }
        html.dcui-enabled .dcui-board-tab:hover {
          border-color: var(--dcui-color-border-soft);
          background: var(--dcui-color-subtle);
          color: var(--dcui-color-link);
        }
        html.dcui-enabled .dcui-board-tab.dcui-active {
          margin: 0;
          background: var(--dcui-color-surface-selected);
          color: var(--dcui-color-nav);
          box-shadow: none;
        }
        html.dcui-enabled .dcui-board-tab-home,
        html.dcui-enabled .dcui-board-tab-concept {
          background: var(--dcui-color-surface-selected);
          color: var(--dcui-color-nav);
        }
        html.dcui-enabled .dcui-board-tab-concept.dcui-active {
          color: var(--dcui-color-link-secondary);
        }
        html.dcui-enabled .dcui-board-tab-home {
          min-width: 38px;
          width: 38px;
          padding: 0;
        }
        html.dcui-enabled .dcui-board-tab-home svg {
          width: 14px;
          height: 14px;
          fill: currentColor;
        }
        html.dcui-enabled .dcui-board-more {
          position: relative;
          display: flex;
          flex: 0 0 33px;
          width: 33px;
          height: 35px;
          margin-left: 0;
        }
        html.dcui-enabled .dcui-board-more[hidden] {
          display: none !important;
        }
        html.dcui-enabled .dcui-board-more-button {
          display: inline-flex;
          width: 33px;
          height: 35px;
          align-items: center;
          justify-content: center;
          padding: 0;
          border: 0;
          border-left: 1px solid var(--dcui-color-border-soft);
          background: var(--dcui-color-surface-notice);
          color: var(--dcui-color-muted);
          cursor: pointer;
        }
        html.dcui-enabled .dcui-board-more-button:hover,
        html.dcui-enabled .dcui-board-more.dcui-active .dcui-board-more-button,
        html.dcui-enabled .dcui-board-more.dcui-open .dcui-board-more-button {
          background: var(--dcui-color-surface-selected);
          color: var(--dcui-color-nav);
        }
        html.dcui-enabled .dcui-board-more-button svg {
          width: 13px;
          height: 13px;
          fill: currentColor;
          transition: transform 120ms ease;
        }
        html.dcui-enabled .dcui-board-more.dcui-open .dcui-board-more-button svg {
          transform: rotate(180deg);
        }
        html.dcui-enabled .dcui-board-more-menu {
          position: absolute;
          z-index: 6;
          top: calc(100% + 1px);
          left: 0;
          display: none;
          box-sizing: border-box;
          width: 100%;
          min-height: 29px;
          padding: 4px 38px 4px var(--dcui-board-menu-start, 0px);
          flex-wrap: wrap;
          align-items: center;
          border: 1px solid var(--dcui-color-border-strong);
          border-radius: 0 0 2px 2px;
          background: var(--dcui-color-surface-notice);
          box-shadow: inset 0 1px 0 var(--dcui-color-control-highlight);
        }
        html.dcui-enabled .dcui-board-more.dcui-open + .dcui-board-more-menu {
          display: flex;
        }
        html.dcui-enabled .dcui-board-more[hidden] + .dcui-board-more-menu {
          display: none !important;
        }
        html.dcui-enabled .dcui-board-more-menu .dcui-board-tab {
          height: 29px;
          padding: 0 12px;
          border-right: 1px solid var(--dcui-color-border-soft);
          line-height: 29px;
          white-space: nowrap;
        }
        html.dcui-enabled .list_array_option .right_box {
          position: relative;
          z-index: 4;
          display: flex !important;
          box-sizing: border-box !important;
          flex: 0 0 160px !important;
          min-width: 160px !important;
          max-width: 160px !important;
          width: 160px !important;
          height: 37px;
          align-self: flex-start;
          margin: 0 0 0 auto !important;
          padding: 0 !important;
          border: 0;
          border-radius: 0;
          background: transparent;
          box-shadow: none;
        }
        html.dcui-enabled .list_array_option .right_box .output_array {
          display: flex !important;
          box-sizing: border-box;
          width: 100%;
          height: 37px;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          margin: 0;
          padding: 0;
        }
        html.dcui-enabled .list_array_option .right_box .switch_btnbox {
          display: flex !important;
          flex: 0 0 auto;
          width: auto;
          height: 35px;
          align-items: center;
          margin: 0;
          padding: 0;
          font-size: 0;
        }
        html.dcui-enabled .list_array_option .dcui-list-size-control {
          position: relative;
          float: none !important;
          box-sizing: border-box;
          width: 67px !important;
          flex: 0 0 67px;
          height: 32px;
          margin: 0 !important;
          border: 1px solid var(--dcui-color-border-strong);
          border-radius: 3px;
          background: linear-gradient(to bottom, var(--dcui-color-control-gradient-top) 0, var(--dcui-color-control-gradient-bottom) 100%);
        }
        html.dcui-enabled .list_array_option .dcui-list-size-control > select {
          display: none !important;
        }
        html.dcui-enabled .list_array_option .dcui-list-size-control > .select_area {
          display: block !important;
          box-sizing: border-box;
          width: 100% !important;
          height: 30px !important;
          margin: 0 !important;
          border: 0;
          background: transparent;
        }
        html.dcui-enabled .list_array_option .dcui-list-size-control > .select_area > a {
          position: relative;
          display: block;
          box-sizing: border-box;
          width: 100%;
          height: 30px;
          overflow: hidden;
          padding: 0 20px 0 9px;
          color: var(--dcui-color-muted);
          font: 700 10px/30px var(--dcui-font);
          text-align: left;
          text-decoration: none;
          white-space: nowrap;
        }
        html.dcui-enabled .list_array_option .dcui-list-size-control > .select_area > a:hover {
          background: var(--dcui-color-surface-selected);
          color: var(--dcui-color-nav);
        }
        html.dcui-enabled .list_array_option .dcui-list-size-control .icon_option_more {
          position: absolute !important;
          top: 13px !important;
          right: 9px !important;
          width: 0 !important;
          height: 0 !important;
          margin: 0 !important;
          border: 4px solid transparent !important;
          border-top-color: var(--dcui-color-muted) !important;
          background: none !important;
        }
        html.dcui-enabled .list_array_option .dcui-list-size-control > #listSizeLayer {
          position: absolute !important;
          z-index: 100;
          top: 35px !important;
          right: -1px !important;
          left: auto !important;
          box-sizing: border-box;
          width: 67px !important;
          margin: 0 !important;
          padding: 2px 0 !important;
          border: 1px solid var(--dcui-color-border-control);
          background: var(--dcui-color-surface);
          box-shadow: 0 3px 7px rgb(0 0 0 / 15%);
        }
        html.dcui-enabled .list_array_option .dcui-list-size-control > #listSizeLayer li {
          display: block;
          width: 100%;
          height: 24px;
          margin: 0;
          padding: 0;
        }
        html.dcui-enabled .list_array_option .dcui-list-size-control > #listSizeLayer a {
          display: block;
          box-sizing: border-box;
          width: 100%;
          height: 24px;
          padding: 0 7px;
          color: var(--dcui-color-text-soft);
          font: 10px/24px var(--dcui-font);
          text-align: left;
          text-decoration: none;
          white-space: nowrap;
        }
        html.dcui-enabled .list_array_option .dcui-list-size-control > #listSizeLayer a:hover {
          background: var(--dcui-color-surface-selected);
          color: var(--dcui-color-nav);
        }
        html.dcui-enabled .dcui-list {
          border-top: 0;
        }
        html.dcui-enabled table.dcui-list-table {
          table-layout: auto;
        }
        html.dcui-enabled table.dcui-list-table thead th {
          box-sizing: border-box;
          height: 33px;
          padding: 7px 6px 5px;
          border-top: 1px solid var(--dcui-color-border-strong);
          border-bottom: 1px solid var(--dcui-color-border-control);
          background: linear-gradient(to bottom, var(--dcui-color-control-gradient-top) 0, var(--dcui-color-control-gradient-soft-bottom) 100%);
          box-shadow: inset 0 -1px 0 var(--dcui-color-control-highlight);
          color: var(--dcui-color-text-soft);
          font-size: 13px;
          white-space: nowrap;
        }
        html.dcui-enabled table.dcui-list-table tbody td {
          box-sizing: border-box;
          height: 36px;
          padding: 6px 6px 4px;
          color: var(--dcui-color-text-soft);
          font-size: 11px;
          line-height: 20px;
        }
        html.dcui-enabled table.dcui-list-table .dcui-hidden-number,
        html.dcui-enabled table.dcui-list-table.dcui-has-subject-column .gall_num {
          display: none !important;
        }
        html.dcui-enabled table.dcui-list-table .dcui-tab-cell {
          box-sizing: border-box;
          width: 68px;
          max-width: 68px;
          padding-left: 8px;
          padding-right: 8px;
          color: var(--dcui-color-link-muted);
          text-align: center;
          white-space: nowrap;
        }
        html.dcui-enabled table.dcui-list-table .dcui-subject-filter-link {
          display: block;
          overflow: hidden;
          width: 100%;
          color: inherit;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcui-enabled table.dcui-list-table .dcui-subject-filter-link:hover,
        html.dcui-enabled table.dcui-list-table .dcui-subject-filter-link:focus-visible {
          color: var(--dcui-color-link);
          text-decoration: underline;
        }
        html.dcui-enabled table.dcui-list-table .gall_tit {
          width: auto;
          padding: 6px 6px 4px;
          text-align: left;
        }
        html.dcui-enabled table.dcui-list-table .gall_tit > a:not(.reply_numbox) {
          color: var(--dcui-color-text-strong);
          font-size: 13px;
          line-height: 20px;
        }
        html.dcui-enabled.dcui-realtime-best table.dcui-list-table {
          table-layout: fixed;
        }
        html.dcui-enabled.dcui-realtime-best table.dcui-list-table colgroup col:nth-child(5),
        html.dcui-enabled.dcui-realtime-best table.dcui-list-table .gall_count {
          width: 68px;
          min-width: 68px;
        }
        html.dcui-enabled.dcui-realtime-best table.dcui-list-table
          tbody tr.thum > td {
          height: 57px;
          vertical-align: middle;
        }
        html.dcui-enabled.dcui-realtime-best table.dcui-list-table
          tbody tr.thum .gall_tit {
          padding-top: 3px;
          padding-bottom: 4px;
        }
        html.dcui-enabled.dcui-realtime-best table.dcui-list-table
          tbody tr.thum .gall_tit > a:not(.reply_numbox) {
          position: relative;
          display: inline-flex;
          box-sizing: border-box;
          align-items: center;
          min-height: 50px;
          padding-left: 80px;
          vertical-align: middle;
        }
        html.dcui-enabled.dcui-realtime-best table.dcui-list-table
          tbody tr.thum .thumimg {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 70px !important;
          height: 50px !important;
          overflow: hidden;
          transform: none !important;
          background: var(--dcui-color-surface-muted);
        }
        html.dcui-enabled.dcui-realtime-best table.dcui-list-table
          tbody tr.thum .thumimg > img {
          position: static !important;
          display: block;
          width: 70px !important;
          height: 50px !important;
          object-fit: cover;
        }
        html.dcui-enabled.dcui-realtime-best table.dcui-list-table
          tbody tr.thum .reply_numbox {
          vertical-align: middle;
        }
        html.dcui-enabled table.dcui-list-table .gall_writer {
          width: 108px;
          min-width: 94px;
          max-width: 116px;
          text-align: left;
        }
        html.dcui-enabled table.dcui-list-table .gall_date {
          width: 72px;
          min-width: 72px;
        }
        html.dcui-enabled table.dcui-list-table .gall_count,
        html.dcui-enabled table.dcui-list-table .gall_recommend {
          width: 52px;
          min-width: 45px;
        }
        html.dcui-enabled table.dcui-list-table .gall_recommend {
          color: var(--dcui-color-link-bright);
          font-weight: 700;
        }
        html.dcui-enabled table.dcui-list-table tr.dcui-row-notice,
        html.dcui-enabled table.dcui-list-table tbody tr:hover {
          background: var(--dcui-color-surface-muted);
        }
        html.dcui-enabled table.dcui-list-table tbody tr.dcui-current-post,
        html.dcui-enabled table.dcui-list-table tbody tr.dcui-current-post:hover,
        html.dcui-enabled table.dcui-list-table tbody tr.dcui-current-post > td {
          background: var(--dcui-color-surface-selected) !important;
        }
        html.dcui-enabled table.dcui-list-table tbody tr.dcui-current-post .dcui-tab-cell {
          box-shadow: inset 3px 0 0 var(--dcui-color-nav-light);
          color: var(--dcui-color-nav);
          font-weight: 700;
        }
        html.dcui-enabled table.dcui-list-table tbody tr.dcui-current-post .gall_tit > a:not(.reply_numbox) {
          color: var(--dcui-color-nav);
          font-weight: 700;
        }
        html.dcui-enabled .list_bottom_btnbox {
          display: none !important;
        }
        html.dcui-enabled .dcui-fm-bottom-menu {
          display: flex;
          box-sizing: border-box;
          align-items: flex-start;
          justify-content: space-between;
          min-height: 43px;
          margin-top: -1px;
          padding: 7px 10px;
          border-top: 1px solid var(--dcui-color-border-strong);
        }
        html.dcui-enabled .dcui-fm-bottom-menu form,
        html.dcui-enabled .dcui-fm-bottom-menu fieldset {
          margin: 0;
          padding: 0;
          border: 0;
        }
        html.dcui-enabled .dcui-fm-bottom-menu .buttom_search_wrap {
          display: flex;
          width: auto !important;
          height: 28px;
          margin: 0;
        }
        html.dcui-enabled .dcui-fm-bottom-menu .bottom_array {
          box-sizing: border-box;
          width: 105px;
          height: 28px;
          margin-left: 4px;
          border: 0;
          background: transparent;
        }
        html.dcui-enabled .dcui-fm-bottom-menu .select_area {
          position: relative;
          box-sizing: border-box;
          width: 100% !important;
          max-width: 100% !important;
          height: 28px;
          overflow: hidden;
          padding: 0 24px 0 7px;
          border-radius: var(--dcui-control-radius);
          color: var(--dcui-color-nav-light);
          cursor: pointer;
          font: 10px/26px var(--dcui-font);
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-fm-bottom-menu #search_type_txt {
          display: block;
          overflow: hidden;
          max-width: 72px;
          color: var(--dcui-color-nav-light);
          font-size: 10px;
          line-height: 26px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-fm-bottom-menu .select_area > .inner {
          position: absolute !important;
          inset: 0 0 0 auto !important;
          display: flex !important;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          width: 23px !important;
          height: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          border-left-color: var(--dcui-control-addon-border);
          background: var(--dcui-control-addon-surface);
        }
        html.dcui-enabled .dcui-fm-bottom-menu .select_area > .inner > .icon_option_more {
          position: static !important;
          display: block !important;
          box-sizing: content-box !important;
          width: 0 !important;
          height: 0 !important;
          margin: 3px 0 0 !important;
          border: 3px solid transparent !important;
          border-top-color: var(--dcui-color-nav-light) !important;
          background: none !important;
        }
        html.dcui-enabled .dcui-fm-bottom-menu .bottom_search {
          position: relative !important;
          box-sizing: border-box;
          width: 175px;
          height: 28px;
          overflow: hidden;
          margin-left: 0 !important;
          border-radius: var(--dcui-control-radius);
        }
        html.dcui-enabled .dcui-fm-bottom-menu .bottom_search .inner_search {
          float: none !important;
          width: 100%;
          height: 26px;
        }
        html.dcui-enabled .dcui-fm-bottom-menu .bottom_search .in_keyword {
          box-sizing: border-box;
          width: 100%;
          height: 26px;
          padding-right: 32px !important;
          background: transparent;
        }
        html.dcui-enabled .dcui-fm-bottom-menu .buttom_search_wrap .bottom_search > .bnt_search {
          position: absolute !important;
          inset: 1px 1px auto auto !important;
          top: 1px !important;
          right: 1px !important;
          left: auto !important;
          float: none !important;
          box-sizing: border-box;
          width: 26px;
          height: 26px;
          overflow: hidden;
          border: 0 !important;
          background: transparent !important;
        }
        html.dcui-enabled .dcui-fm-bottom-menu .buttom_search_wrap .bottom_search > .bnt_search::before {
          position: absolute;
          top: 6px;
          left: 6px;
          box-sizing: border-box;
          width: 8px;
          height: 8px;
          border: 1.5px solid var(--dcui-color-icon);
          border-radius: 50%;
          content: "";
        }
        html.dcui-enabled .dcui-fm-bottom-menu .buttom_search_wrap .bottom_search > .bnt_search::after {
          position: absolute;
          top: 14px;
          left: 13px;
          width: 5px;
          height: 1.5px;
          background: var(--dcui-color-icon);
          content: "";
          transform: rotate(45deg);
          transform-origin: left center;
        }
        html.dcui-enabled .dcui-fm-bottom-actions {
          display: flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 5px;
        }
        html.dcui-enabled .dcui-fm-bottom-button,
        html.dcui-enabled .list_array_option .dcui-top-write-button {
          display: inline-flex;
          box-sizing: border-box;
          height: 28px;
          align-items: center;
          justify-content: center;
          margin: 0;
          padding: 0 12px;
          border: 1px solid var(--dcui-color-border-strong);
          border-radius: 3px;
          background: linear-gradient(to bottom, var(--dcui-color-control-gradient-top) 0, var(--dcui-color-control-gradient-bottom) 100%);
          color: var(--dcui-color-text-soft);
          font: 11px/26px var(--dcui-font);
          letter-spacing: normal;
          white-space: normal;
          cursor: pointer;
          text-decoration: none;
        }
        html.dcui-enabled .dcui-fm-bottom-button,
        html.dcui-enabled .list_array_option .dcui-top-write-button {
          text-shadow: none;
        }
        html.dcui-enabled .dcui-fm-bottom-actions > .dcui-fm-bottom-button,
        html.dcui-enabled .list_array_option .dcui-top-write-button {
          width: auto !important;
          min-width: 64px !important;
        }
        html.dcui-enabled .list_array_option .dcui-top-write-button {
          border-color: var(--dcui-color-border-strong) !important;
          color: var(--dcui-color-text-soft) !important;
          min-width: 70px !important;
          height: 32px;
          padding-right: 14px;
          padding-left: 14px;
          line-height: 30px;
        }
        html.dcui-enabled .dcui-fm-concept-button.dcui-active {
          color: var(--dcui-color-link-secondary);
          font-weight: 700;
        }
        html.dcui-enabled .dcui-fm-write-button::before,
        html.dcui-enabled .list_array_option .dcui-top-write-button::before {
          width: auto;
          height: auto;
          margin: 0 4px 0 0;
          background: none;
          font: inherit;
          letter-spacing: normal;
          color: var(--dcui-color-muted);
          content: "✎";
        }
        html.dcui-enabled .dcui-fm-bottom-button:hover,
        html.dcui-enabled .list_array_option .dcui-top-write-button:hover {
          border-color: var(--dcui-color-faint);
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
          text-decoration: none;
        }
        html.dcui-enabled .bottom_paging_wrap {
          box-sizing: border-box;
          height: 36px !important;
          min-height: 36px;
          margin-top: 0;
          padding-top: 10px;
          border-top: 0;
        }
        html.dcui-enabled .bottom_paging_box > a,
        html.dcui-enabled .bottom_paging_box > em {
          width: auto;
          min-width: 26px;
          height: 26px;
          padding: 0 6px !important;
          border-radius: 2px;
          color: var(--dcui-color-faint);
          font: 700 12px/24px Tahoma, sans-serif;
        }
        html.dcui-enabled .bottom_paging_box > em {
          border-color: var(--dcui-color-faint);
          background: var(--dcui-color-subtle);
          color: var(--dcui-color-text-soft);
        }
        html.dcui-enabled .bottom_paging_box .page_end,
        html.dcui-enabled .bottom_movebox {
          display: none !important;
        }
      `;
      document.documentElement.appendChild(style);
    },
  });

  const ArticleView = Object.freeze({
    mount(context) {
      if (context.pageType !== "view") return null;

      const articleRoot = DcAdapter.articleRoot();
      if (!articleRoot) return null;

      articleRoot.classList.add("dcui-article");
      const articleHeader = DcAdapter.articleHeader();
      const articleBody = DcAdapter.articleBody();
      const commentRoot = DcAdapter.commentRoot();
      articleHeader?.classList.add("dcui-article-header");
      articleBody?.classList.add("dcui-article-body");
      commentRoot?.classList.add("dcui-comments");
      this.decorateHeader(articleHeader);
      this.bindRecommendationReadinessGuard();
      this.mountQuickNavigation({ articleRoot, articleHeader, articleBody, commentRoot });
      this.injectStyle();
      this.bindResponsiveMovieFrames(articleBody);

      return { articleRoot, articleHeader, articleBody, commentRoot };
    },

    mountQuickNavigation({ articleRoot, articleHeader, articleBody, commentRoot }) {
      if (document.getElementById("dcui-article-quick-nav")) return;

      const ensureTargetId = (node, fallbackId) => {
        if (!node) return "";
        if (!node.id) node.id = fallbackId;
        return node.id;
      };
      const targets = [
        {
          role: "top",
          label: "위로",
          icon: "\uf062",
          target: document.getElementById("top") || articleHeader || articleRoot,
          fallbackId: "dcui-article-top",
        },
        {
          role: "bottom",
          label: "아래로",
          icon: "\uf063",
          target: document.getElementById("bottom_listwrap")
            || document.querySelector(".view_bottom_btnbox")
            || articleBody,
          fallbackId: "dcui-article-bottom",
        },
        {
          role: "comments",
          label: "댓글로 가기",
          icon: "\uf075",
          target: commentRoot,
          fallbackId: "dcui-comments-anchor",
        },
      ];
      if (targets.some((item) => !item.target)) return;

      const nav = document.createElement("nav");
      nav.id = "dcui-article-quick-nav";
      nav.setAttribute("aria-label", "본문 빠른 이동");
      for (const item of targets) {
        const targetId = ensureTargetId(item.target, item.fallbackId);
        const link = document.createElement("a");
        link.href = `#${targetId}`;
        link.dataset.role = item.role;
        link.setAttribute("aria-label", item.label);
        link.addEventListener("click", (event) => {
          event.preventDefault();
          if (item.role === "top") {
            window.scrollTo({ top: 0, behavior: "auto" });
            return;
          }
          item.target.scrollIntoView({ behavior: "auto", block: "start" });
        });

        const icon = document.createElement("span");
        icon.className = `dcui-quick-nav-icon dcui-quick-nav-icon-${item.role}`;
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = item.icon;
        const text = document.createElement("b");
        text.textContent = item.label;
        link.append(icon, text);
        nav.appendChild(link);
      }
      document.body.appendChild(nav);
    },

    bindResponsiveMovieFrames(articleBody) {
      const root = articleBody?.querySelector(".writing_view_box") || articleBody;
      if (!root || root.dataset.dcuiMovieFramesBound === "true") return;
      root.dataset.dcuiMovieFramesBound = "true";
      const selector = 'iframe[id^="movieIcon"][src*="/board/movie/movie_view"]';
      const prepare = (frame) => {
        if (!(frame instanceof HTMLIFrameElement)) return;
        if (frame.dataset.dcuiResponsiveMovieBound !== "true") {
          frame.dataset.dcuiResponsiveMovieBound = "true";
          frame.addEventListener("load", () => this.fitResponsiveMovieFrame(frame));
        }
        this.fitResponsiveMovieFrame(frame);
      };
      const scan = (scope = root) => {
        if (scope.matches?.(selector)) prepare(scope);
        scope.querySelectorAll?.(selector).forEach(prepare);
      };

      scan();
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => {
            if (node instanceof Element) scan(node);
          });
        }
      });
      observer.observe(root, { childList: true, subtree: true });
    },

    fitResponsiveMovieFrame(frame, attempt = 0) {
      if (!frame?.isConnected) return;
      let innerDocument;
      try {
        innerDocument = frame.contentDocument;
      } catch {
        return;
      }
      const container = innerDocument?.querySelector(".v-container");
      const videoInbox = innerDocument?.querySelector(".video_inbox");
      if (!container || !videoInbox) {
        if (attempt < 6) {
          window.setTimeout(() => this.fitResponsiveMovieFrame(frame, attempt + 1), 150 * (attempt + 1));
        }
        return;
      }

      const originalWidth = Number.parseFloat(container.style.width) || container.getBoundingClientRect().width;
      const originalHeight = Number.parseFloat(videoInbox.style.height) || videoInbox.getBoundingClientRect().height;
      if (!(originalWidth > 0) || !(originalHeight > 0)) return;

      let style = innerDocument.getElementById("dcui-responsive-movie-style");
      if (!style) {
        style = innerDocument.createElement("style");
        style.id = "dcui-responsive-movie-style";
        innerDocument.head.appendChild(style);
      }
      style.textContent = `
        html, body {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
        }
        .v-container {
          box-sizing: border-box !important;
          width: min(100%, ${originalWidth}px) !important;
          max-width: 100% !important;
        }
        .video_wrap, .video_inbox, .dc_mv, .video_infobox {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
        }
        .video_wrap {
          display: block !important;
        }
        .video_inbox {
          height: auto !important;
          aspect-ratio: ${originalWidth} / ${originalHeight};
        }
        .dc_mv {
          display: block !important;
          height: 100% !important;
          object-fit: contain;
        }
      `;
      frame.style.setProperty("width", "100%", "important");
      frame.style.setProperty("max-width", "100%", "important");
      frame.style.setProperty("display", "block", "important");

      frame.__dcuiMovieResizeObserver?.disconnect();
      const syncHeight = () => {
        if (!frame.isConnected || !container.isConnected) return;
        const height = Math.ceil(container.getBoundingClientRect().height);
        if (height > 0) frame.style.setProperty("height", `${height}px`, "important");
      };
      const resizeObserver = new ResizeObserver(syncHeight);
      resizeObserver.observe(container);
      frame.__dcuiMovieResizeObserver = resizeObserver;
      innerDocument.defaultView?.requestAnimationFrame(() => {
        syncHeight();
        innerDocument.defaultView?.requestAnimationFrame(syncHeight);
      });
    },

    bindRecommendationReadinessGuard() {
      if (document.documentElement.dataset.dcuiRecommendationGuard === "true") return;
      document.documentElement.dataset.dcuiRecommendationGuard = "true";
      const queued = new WeakSet();
      const replaying = new WeakSet();
      const ready = (button) => {
        const galleryId = cleanText(document.getElementById("id")?.value);
        const encryptedNo = cleanText(document.getElementById("e_s_n_o")?.value);
        const postNo = cleanText(button?.dataset.no);
        const token = document.cookie.match(/(?:^|;\s*)ci_c=([^;]+)/)?.[1] || "";
        return Boolean(galleryId && encryptedNo && postNo && token);
      };

      document.addEventListener("click", (event) => {
        const button = event.target.closest?.(".btn_recom_up, .btn_recom_down");
        if (!button) return;
        if (replaying.has(button)) {
          replaying.delete(button);
          return;
        }
        if (ready(button)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        if (queued.has(button)) return;
        queued.add(button);
        const startedAt = performance.now();
        const retry = () => {
          if (!button.isConnected) {
            queued.delete(button);
            return;
          }
          if (ready(button) || performance.now() - startedAt >= 2500) {
            queued.delete(button);
            replaying.add(button);
            button.click();
            return;
          }
          window.setTimeout(retry, 50);
        };
        window.setTimeout(retry, 50);
      }, true);
    },

    decorateHeader(articleHeader) {
      if (!articleHeader || articleHeader.dataset.dcuiHeaderDecorated === "true") return;

      const title = articleHeader.querySelector(".title");
      const originalDate = articleHeader.querySelector(".gall_date");
      if (title && originalDate) {
        const date = document.createElement("span");
        date.className = "dcui-article-date";
        date.textContent = cleanText(originalDate.getAttribute("title") || originalDate.textContent);
        title.appendChild(date);
        originalDate.classList.add("dcui-original-date");
      }

      const metrics = [
        [articleHeader.querySelector(".gall_count"), "조회"],
        [articleHeader.querySelector(".gall_reply_num"), "추천"],
      ];
      for (const [node, label] of metrics) {
        if (!node) continue;
        const value = cleanText(node.textContent).match(/[\d,]+/)?.[0] || "0";
        node.textContent = `${label} ${value}`;
      }
      const comment = articleHeader.querySelector(".gall_comment a");
      if (comment) {
        const value = cleanText(comment.textContent).match(/[\d,]+/)?.[0] || "0";
        comment.textContent = `댓글 ${value}`;
      }

      articleHeader.dataset.dcuiHeaderDecorated = "true";
    },

    injectStyle() {
      if (document.getElementById("dcui-article-style")) return;

      const fontAwesomeUrl = GM_getResourceURL("dcui-fontawesome");
      const style = document.createElement("style");
      style.id = "dcui-article-style";
      style.textContent = `
        @font-face {
          font-family: "dcui-FontAwesome";
          src: url("${fontAwesomeUrl}") format("woff2");
          font-style: normal;
          font-weight: normal;
          font-display: block;
        }
        #dcui-article-quick-nav {
          display: none;
        }
        html.dcui-enabled #dcui-article-quick-nav {
          position: fixed;
          right: max(12px, calc((100vw - 1050px) / 2 - 40px));
          bottom: 50px;
          z-index: 100;
          display: flex;
          box-sizing: border-box;
          width: 30px;
          flex-direction: column;
          margin: 0;
          padding: 0;
          overflow: visible;
          border: 1px solid var(--dcui-color-border-strong);
          border-radius: 4px;
          background: var(--dcui-color-surface-muted);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
          font-family: var(--dcui-font);
        }
        html.dcui-enabled #dcui-article-quick-nav > a {
          position: relative;
          display: flex;
          box-sizing: border-box;
          width: 28px;
          height: 28px;
          align-items: center;
          justify-content: center;
          margin: 0;
          padding: 0;
          border-bottom: 1px solid var(--dcui-color-border-soft);
          color: var(--dcui-color-faint);
          text-decoration: none;
        }
        html.dcui-enabled #dcui-article-quick-nav > a:last-child {
          border-bottom: 0;
        }
        html.dcui-enabled #dcui-article-quick-nav > a:hover,
        html.dcui-enabled #dcui-article-quick-nav > a:focus-visible {
          z-index: 1;
          background: var(--dcui-color-surface-muted);
          color: var(--dcui-color-nav-light);
          outline: 0;
        }
        html.dcui-enabled #dcui-article-quick-nav > a > b {
          position: absolute;
          overflow: hidden;
          width: 1px;
          height: 1px;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        html.dcui-enabled #dcui-article-quick-nav .dcui-quick-nav-icon {
          display: inline-block;
          flex: 0 0 auto;
          width: 16px;
          color: currentColor;
          font: normal normal normal 13px/1 "dcui-FontAwesome";
          text-align: center;
          text-rendering: auto;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        html.dcui-enabled #top,
        html.dcui-enabled #bottom_listwrap,
        html.dcui-enabled #dcui-article-top,
        html.dcui-enabled #dcui-article-bottom,
        html.dcui-enabled #dcui-comments-anchor {
          scroll-margin-top: 8px;
        }
        html.dcui-enabled .dcui-article {
          box-sizing: border-box;
          width: 100%;
          color: var(--dcui-color-text);
          font-family: var(--dcui-font);
        }
        html.dcui-enabled .dcui-article .dcui-article-header {
          margin: 0;
          padding: 0;
          border-top: 2px solid var(--dcui-color-nav-light);
          border-bottom: 1px solid var(--dcui-color-border);
          background: var(--dcui-color-surface);
        }
        html.dcui-enabled .dcui-article .dcui-article-header .title {
          min-height: 52px;
          margin: 0;
          padding: 15px 12px 11px;
          color: var(--dcui-color-text-strong);
          font-size: 19px;
          font-weight: 700;
          line-height: 25px;
          letter-spacing: -0.4px;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .gall_writer {
          min-height: 38px;
          padding: 9px 12px;
          border-top: 1px solid var(--dcui-color-border);
          background: var(--dcui-color-subtle);
          color: var(--dcui-color-muted);
          line-height: 19px;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .gall_writer .nickname,
        html.dcui-enabled .dcui-article .dcui-article-header .gall_writer .nickname em {
          color: var(--dcui-color-text-soft);
          font-weight: 700;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .gall_date {
          margin-left: 9px;
          color: var(--dcui-color-faint);
          font-size: 11px;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .fr > span {
          margin-left: 10px;
          color: var(--dcui-color-muted);
          font-size: 11px;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .gall_comment a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          min-width: 52px;
          height: 22px;
          padding: 0 10px 2px;
          line-height: normal;
          vertical-align: middle;
          color: var(--dcui-color-link);
          text-decoration: none;
        }
        html.dcui-enabled .dcui-article-body {
          border-bottom: 0;
          background: var(--dcui-color-surface);
        }
        html.dcui-enabled .dcui-article-body > .inner {
          box-sizing: border-box;
          width: 100%;
          padding: 32px 12px 22px;
        }
        html.dcui-enabled .dcui-article-body .writing_view_box,
        html.dcui-enabled .dcui-article-body .write_div {
          box-sizing: border-box;
          width: 100% !important;
          max-width: 100%;
          color: var(--dcui-color-text-strong);
          font-size: 14px;
          line-height: 1.7;
        }
        html.dcui-enabled .dcui-article-body .writing_view_box img,
        html.dcui-enabled .dcui-article-body .writing_view_box video {
          max-width: 100% !important;
          height: auto !important;
        }
        html.dcui-enabled .dcui-article-body .writing_view_box iframe,
        html.dcui-enabled .dcui-article-body .writing_view_box embed {
          max-width: 100% !important;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box {
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }
        html.dcui-enabled .dcui-article-body .recom_bottom_box {
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }
        html.dcui-enabled .dcui-article-body .appending_file_box {
          margin-top: 24px;
          padding: 10px 12px;
          border: 1px solid var(--dcui-color-border);
          background: var(--dcui-color-subtle);
          color: var(--dcui-color-muted);
        }
        html.dcui-enabled .view_bottom_btnbox {
          min-height: 44px;
          padding-top: 10px;
          border-top: 1px solid var(--dcui-color-border);
        }
        html.dcui-enabled .view_bottom_btnbox button {
          height: 30px;
          border: 1px solid var(--dcui-color-nav-light);
          border-radius: 0;
          background: var(--dcui-color-nav-light);
          color: var(--dcui-color-on-accent);
          line-height: 28px;
        }
        html.dcui-enabled .dcui-comments {
          margin-top: 28px;
          border-top: 2px solid var(--dcui-color-nav-light);
          color: var(--dcui-color-text);
          font-family: var(--dcui-font);
        }
        html.dcui-enabled .dcui-comments .comment_count {
          box-sizing: border-box;
          min-height: 42px;
          padding: 10px 12px;
          border-bottom: 1px solid var(--dcui-color-border);
          background: var(--dcui-color-subtle);
        }
        html.dcui-enabled .dcui-comments .comment_count .font_red {
          color: var(--dcui-color-link);
        }
        html.dcui-enabled .dcui-comments .comment_box {
          border-bottom: 1px solid var(--dcui-color-border);
        }
        html.dcui-enabled .dcui-comments .cmt_list {
          margin: 0;
          padding: 0;
        }
        html.dcui-enabled .dcui-comments .ub-content.block-disable {
          display: none !important;
        }
        html.dcui-enabled .dcui-comments .cmt_list > li.ub-content.dory {
          display: none !important;
        }
        html.dcui-enabled .dcui-comments .cmt_info {
          position: relative;
        }
        html.dcui-enabled .dcui-comments .cmt_info > .addbox {
          display: flex !important;
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          padding-right: 140px;
        }
        html.dcui-enabled .dcui-comments .cmt_info > .addbox > .cmt_nickbox {
          float: none !important;
          flex: 0 0 152px;
          min-width: 0;
        }
        html.dcui-enabled .dcui-comments .cmt_info > .addbox > .cmt_txtbox {
          float: none !important;
          flex: 1 1 auto;
          width: auto !important;
          max-width: calc(100% - 152px);
          min-width: 0;
        }
        html.dcui-enabled .dcui-comments .cmt_info > .fr {
          position: absolute;
          top: 9px;
          right: 3px;
          float: none !important;
        }
        html.dcui-enabled .dcui-comments .cmt_info > .addbox > .fr {
          position: absolute;
          top: 9px;
          right: 3px;
          float: none !important;
        }
        html.dcui-enabled .dcui-comments .reply_info {
          position: relative;
          min-width: 0;
        }
        html.dcui-enabled .dcui-comments .reply_info:not(:has(> .addbox)) {
          display: flex;
          box-sizing: border-box;
          width: 100%;
          padding-right: 140px;
        }
        html.dcui-enabled .dcui-comments .reply_info > .addbox {
          display: flex !important;
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          padding-right: 140px;
        }
        html.dcui-enabled .dcui-comments .reply_info > .cmt_nickbox,
        html.dcui-enabled .dcui-comments .reply_info > .addbox > .cmt_nickbox {
          float: none !important;
          flex: 0 0 133px;
          min-width: 0;
        }
        html.dcui-enabled .dcui-comments .reply_info > .cmt_txtbox,
        html.dcui-enabled .dcui-comments .reply_info > .usertxt,
        html.dcui-enabled .dcui-comments .reply_info > .addbox > .cmt_txtbox,
        html.dcui-enabled .dcui-comments .reply_info > .addbox > .usertxt {
          float: none !important;
          flex: 1 1 auto;
          width: auto !important;
          max-width: calc(100% - 133px);
          min-width: 0;
        }
        html.dcui-enabled .dcui-comments .cmt_info .cmt_txtbox > .usertxt,
        html.dcui-enabled .dcui-comments .reply_info .cmt_txtbox > .usertxt {
          box-sizing: border-box;
          width: auto !important;
          max-width: 100%;
          min-width: 0;
        }
        html.dcui-enabled .dcui-comments .cmt_txtbox:has(> .comment_dccon) {
          display: inline-flex !important;
          flex: 1 1 auto;
          flex-flow: row nowrap;
          align-items: flex-start;
          width: auto !important;
          max-width: 100%;
        }
        html.dcui-enabled .dcui-comments .cmt_txtbox:has(> .mention) {
          flex-wrap: wrap;
        }
        html.dcui-enabled .dcui-comments .cmt_txtbox:has(> .mention) > .mention {
          flex: 0 0 100%;
        }
        html.dcui-enabled .dcui-comments .cmt_txtbox > .comment_dccon,
        html.dcui-enabled .dcui-comments .reply_info .comment_dccon {
          float: none !important;
          flex: 0 0 auto;
          width: auto !important;
          max-width: none;
        }
        html.dcui-enabled .dcui-comments .coment_dccon_info {
          box-sizing: border-box;
          width: max-content;
        }
        html.dcui-enabled .dcui-comments .coment_dccon_info > .over_alt {
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-comments .reply_info > .fr {
          position: absolute;
          top: 0;
          right: 0;
          float: none !important;
        }
        html.dcui-enabled .dcui-comments .reply_info > .addbox > .fr {
          position: absolute;
          top: 0;
          right: 0;
          float: none !important;
        }
        html.dcui-enabled .dcui-comments .cmt_info {
          color: var(--dcui-color-muted);
          font-size: 11px;
        }
        html.dcui-enabled .dcui-comments .cmt_nickbox .nickname,
        html.dcui-enabled .dcui-comments .cmt_nickbox .nickname em {
          color: var(--dcui-color-text-soft);
          font-weight: 700;
        }
        html.dcui-enabled .dcui-comments .cmt_nickbox:has(> .dcui-user-identifier),
        html.dcui-enabled .dcui-comments .cmt_nickbox .addbox:has(> .dcui-user-identifier) {
          display: flex;
          align-items: center;
          min-width: 0;
        }
        html.dcui-enabled .dcui-comments .cmt_nickbox:has(> .dcui-user-identifier) > .nickname,
        html.dcui-enabled .dcui-comments .cmt_nickbox .addbox:has(> .dcui-user-identifier) > .nickname {
          flex: 0 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-comments .cmt_nickbox .dcui-user-identifier {
          flex: 0 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-user-identifier {
          margin-left: 3px;
          color: var(--dcui-color-faint);
          font-size: 10px;
          font-weight: 400;
          pointer-events: none;
        }
        html.dcui-enabled table.dcui-list-table .dcui-user-identifier {
          font-size: 9px;
        }
        html.dcui-enabled .dcui-comments .cmt_txtbox {
          padding-top: 0;
          color: var(--dcui-color-text-strong);
          font-size: 13px;
          line-height: 1.6;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box {
          padding-top: 19px !important;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box {
          box-sizing: border-box;
          width: 100%;
          margin-top: 12px;
          padding: 12px;
          border: 1px solid var(--dcui-color-border);
          background: var(--dcui-color-subtle);
        }
        html.dcui-enabled .dcui-comments .cmt_write_box input,
        html.dcui-enabled .dcui-comments .cmt_write_box textarea {
          border: 1px solid var(--dcui-color-border-strong);
          border-radius: 0;
          background: var(--dcui-color-surface);
          color: var(--dcui-color-text);
        }
        html.dcui-enabled .dcui-comments .cmt_write_box textarea {
          box-sizing: border-box;
          width: 100%;
          min-height: 78px;
          padding: 9px;
          resize: vertical;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box button {
          border-radius: 0;
        }
        html.dcui-enabled .dcui-comments .btn_cmt_refresh,
        html.dcui-enabled .dcui-comments .btn_cmt_close,
        html.dcui-enabled .dcui-comments .contgo {
          color: var(--dcui-color-muted);
          font-size: 13px;
        }
        html.dcui-enabled .dcui-comments .comment_box > .bottom_paging_box {
          height: auto !important;
          min-height: 38px !important;
          padding: 6px 0 !important;
        }
        html.dcui-enabled .dcui-comments .comment_box > .bottom_paging_box > .cmt_paging {
          display: flex;
          flex: 0 1 auto;
          height: 26px;
          align-items: center;
          justify-content: center;
          padding: 0 !important;
        }
        html.dcui-enabled .dcui-comments .comment_box > .bottom_paging_box > .cmt_inner {
          top: 50% !important;
          margin-top: 0 !important;
          transform: translateY(-50%);
        }
        html.dcui-enabled .dcui-article .dcui-article-header {
          margin: 0 0 6px;
          border-top: 1px solid var(--dcui-color-border-strong) !important;
          border-bottom: 1px solid var(--dcui-color-border-strong);
        }
        html.dcui-enabled .dcui-article .dcui-article-header .title {
          position: relative;
          box-sizing: border-box;
          min-height: 43px;
          padding: 11px 155px 9px 11px;
          border-bottom: 1px solid var(--dcui-color-border-strong);
          background: var(--dcui-color-surface-muted);
          color: var(--dcui-color-text-strong);
          font-size: 17px;
          line-height: 18px;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .dcui-article-date {
          position: absolute;
          top: 13px;
          right: 11px;
          color: var(--dcui-color-faint);
          font-size: 11px;
          font-weight: 400;
          letter-spacing: 0;
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .gall_writer {
          display: flex;
          box-sizing: border-box;
          align-items: center;
          justify-content: space-between;
          min-height: 34px;
          padding: 6px 11px;
          border-top: 0;
          background: var(--dcui-color-surface);
          line-height: 19px;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .dcui-original-date,
        html.dcui-enabled .dcui-article .dcui-article-header .gall_scrap {
          display: none !important;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .gall_writer > .fl,
        html.dcui-enabled .dcui-article .dcui-article-header .gall_writer > .fr {
          float: none;
          display: flex;
          align-items: center;
          min-height: 22px;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .gall_writer > .fr {
          flex-shrink: 0;
          padding: 0;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .fr > .gall_count,
        html.dcui-enabled .dcui-article .dcui-article-header .fr > .gall_reply_num {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          height: 22px;
          padding: 0 10px 2px;
          line-height: normal;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .fr > span {
          position: relative;
          margin-left: 0;
          color: var(--dcui-color-muted);
          font-size: 11px;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .fr > .gall_comment {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          height: 22px;
          padding: 0 0 0 10px;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .gall_comment a {
          margin: 0;
        }
        html.dcui-enabled .dcui-article .dcui-article-header .fr > span::before {
          position: absolute;
          top: 50%;
          left: 0;
          margin: 0;
          transform: translateY(-50%);
        }
        html.dcui-enabled .dcui-article-body > .inner {
          margin-bottom: 0 !important;
          padding: 0 15px;
        }
        html.dcui-enabled .dcui-article-body .writing_view_box,
        html.dcui-enabled .dcui-article-body .write_div {
          min-height: 0 !important;
          margin-bottom: 0 !important;
          padding-bottom: 0 !important;
          font-size: 13px;
          line-height: 1.6;
        }
        /* 1.9.37의 분할 추천 UI는 원본 디시 컨트롤을 사용하도록 비활성화한다. */
        @media not all {
        html.dcui-enabled .dcui-article-body .btn_recommend_box {
          width: 100%;
          min-height: 0 !important;
          height: auto !important;
          margin-top: 8px !important;
          margin-bottom: 0 !important;
          padding: 6px 0 2px;
          border: 0;
          border-top: 1px solid var(--dcui-color-border);
          background: transparent;
        }
        html.dcui-enabled .dcui-article-body .positionr {
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box > .inner_box {
          display: flex;
          width: auto;
          height: 34px;
          align-items: stretch;
          justify-content: center;
          gap: 8px;
          margin: 0 auto;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box > .inner_box > .inner {
          display: grid;
          box-sizing: border-box;
          grid-template-columns: 34px 42px;
          width: 76px;
          height: 34px;
          align-items: center;
          margin: 0;
          padding: 0;
          overflow: hidden;
          border: 1px solid var(--dcui-color-border-strong);
          border-radius: 4px;
          background: var(--dcui-color-surface);
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box > .inner_box > .inner:has(.btn_recom_up) {
          grid-template-columns: 34px 84px;
          width: 118px;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_up,
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_down {
          grid-column: 1;
          grid-row: 1;
          box-sizing: border-box;
          width: 34px;
          min-width: 34px;
          height: 34px;
          margin: 0;
          border: 0;
          border-right: 1px solid var(--dcui-color-border-soft);
          border-radius: 0;
          padding: 0;
          background: var(--dcui-color-surface-muted);
          box-shadow: none;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_up:hover,
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_down:hover {
          background: var(--dcui-color-surface-selected);
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_up::after,
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_down::after {
          content: none;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_up::before,
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_down::before {
          display: block;
          width: 32px;
          height: 32px;
          color: var(--dcui-color-link-secondary);
          font-family: Arial, sans-serif;
          font-weight: 700;
          line-height: 32px;
          text-align: center;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_up::before {
          content: "☆";
          font-size: 25px;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_up.on::before {
          content: "★";
          color: #e2a900;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_down::before {
          content: "×";
          color: var(--dcui-color-icon);
          font-size: 27px;
          font-weight: 400;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_up em,
        html.dcui-enabled .dcui-article-body .btn_recommend_box .btn_recom_down em {
          display: none !important;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .up_num_box,
        html.dcui-enabled .dcui-article-body .btn_recommend_box .down_num_box {
          grid-column: 2;
          grid-row: 1;
          display: grid;
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          height: 32px;
          align-items: center;
          margin: 0;
          padding: 0;
          border: 0;
          border-radius: 0;
          background: var(--dcui-color-surface);
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .up_num_box {
          grid-template-columns: 42px 42px;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .down_num_box {
          grid-template-columns: 42px;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .up_num_box .up_num,
        html.dcui-enabled .dcui-article-body .btn_recommend_box .down_num_box .down_num,
        html.dcui-enabled .dcui-article-body .btn_recommend_box .up_num_box .sup_num {
          display: flex !important;
          box-sizing: border-box;
          min-width: 0;
          height: 32px;
          align-items: center;
          justify-content: center;
          margin: 0;
          padding: 0 4px;
          font: 700 12px/32px Tahoma, sans-serif;
          text-align: center;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .up_num_box .sup_num {
          gap: 3px;
          border-left: 1px solid var(--dcui-color-border-soft);
          color: var(--dcui-color-text-soft);
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .up_num_box .sup_num .writer_nikcon {
          display: inline-flex;
          align-items: center;
          margin: 0;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .up_num_box .sup_num img {
          display: block;
          width: auto;
          max-width: 13px !important;
          height: auto !important;
          max-height: 13px;
          margin: 0;
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .up_num_box .up_num {
          color: var(--dcui-color-link-bright);
        }
        html.dcui-enabled .dcui-article-body .btn_recommend_box .down_num_box .down_num {
          color: var(--dcui-color-muted);
        }
        html.dcui-enabled .dcui-article-body .recom_bottom_box {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          min-height: 22px;
          height: 22px !important;
          margin-top: 5px;
          margin-bottom: 0 !important;
          padding: 0 !important;
        }
        html.dcui-enabled .dcui-article-body .recom_bottom_box button {
          float: none !important;
          min-width: 0;
          height: 22px;
          margin: 0 !important;
          padding: 0 6px;
          line-height: 20px;
          white-space: nowrap;
        }
        }
        html.dcui-enabled .dcui-article-body .positionr {
          margin-top: 30px !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }
        html.dcui-enabled .dcui-comments {
          margin-top: 10px !important;
        }
        html.dcui-enabled .dcui-article-body > div:not([class])[style*="width:100%"][style*="text-align:center"] {
          display: none !important;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr);
          row-gap: 5px;
          width: 100% !important;
          min-height: 0 !important;
          margin-top: 8px;
          padding: 8px;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box > .fl {
          display: flex;
          float: none !important;
          width: auto !important;
          min-width: 0;
          min-height: 18px;
          align-items: center;
          gap: 5px;
          margin: 0 !important;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box .user_info_input {
          box-sizing: border-box;
          width: auto !important;
          min-width: 96px;
          margin: 0 !important;
          border-right: 1px solid var(--dcui-color-border-strong) !important;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box .user_info_input label {
          display: block;
          box-sizing: border-box;
          overflow: hidden;
          width: 100%;
          margin: 0;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box .user_info_input.id > label {
          width: 100% !important;
          height: 100%;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box .user_info_input input {
          box-sizing: border-box;
          width: 100px !important;
          min-width: 80px;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box > .cmt_txt_cont {
          float: none !important;
          box-sizing: border-box;
          width: auto !important;
          min-width: 0;
          margin: 0 !important;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box .cmt_write {
          float: none !important;
          box-sizing: border-box;
          width: 100% !important;
          min-width: 0;
          margin: 0 !important;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box .cmt_write textarea {
          display: block;
          box-sizing: border-box;
          width: 100% !important;
          min-width: 0;
          min-height: 70px;
          height: 70px;
          margin: 0 !important;
          padding: 7px 8px;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box .cmt_textarea_label {
          box-sizing: border-box;
          width: 100% !important;
          padding: 7px 8px;
          font-size: 11px;
          line-height: 18px;
        }
        html.dcui-enabled .dcui-comments .cmt_write_box .cmt_cont_bottm {
          box-sizing: border-box;
          width: 100% !important;
          min-height: 26px;
          margin-top: 5px;
        }
        html.dcui-enabled .view_bottom_btnbox {
          box-sizing: border-box;
          width: 100%;
          min-height: 27px;
          height: 27px;
          margin: 7px 0 5px !important;
          padding: 0 !important;
          border-top: 0;
        }
        html.dcui-enabled .view_bottom_btnbox > .fl,
        html.dcui-enabled .view_bottom_btnbox > .fr {
          display: flex;
          align-items: center;
          gap: 4px;
          height: 27px;
        }
        html.dcui-enabled .view_bottom_btnbox button {
          box-sizing: border-box;
          min-width: 54px;
          height: 26px;
          padding: 0 10px;
          border: 1px solid var(--dcui-color-border-strong);
          border-radius: 3px;
          background: linear-gradient(to bottom, var(--dcui-color-control-gradient-top) 0, var(--dcui-color-control-gradient-bottom) 100%);
          color: var(--dcui-color-text-soft);
          font-family: var(--dcui-font) !important;
          font-size: 11px !important;
          font-style: normal;
          line-height: 24px !important;
          letter-spacing: normal;
          white-space: nowrap;
          text-shadow: none;
        }
        html.dcui-enabled .view_bottom_btnbox > .fr .write {
          font-weight: 400 !important;
        }
        html.dcui-enabled .view_bottom_btnbox > .fl .concept.btn_lightpurple {
          border-color: var(--dcui-color-nav-light) !important;
          background: var(--dcui-color-nav-light) !important;
          color: var(--dcui-color-on-accent) !important;
          font-weight: 700 !important;
        }
        html.dcui-enabled .view_bottom_btnbox > .fl .concept.btn_whitepurple {
          border-color: var(--dcui-color-border-strong) !important;
          background: linear-gradient(to bottom, var(--dcui-color-control-gradient-top) 0, var(--dcui-color-control-gradient-bottom) 100%) !important;
          color: var(--dcui-color-text-soft) !important;
          font-weight: 400 !important;
        }
        html.dcui-enabled.dcui-page-view #bottom_listwrap,
        html.dcui-enabled.dcui-page-view #bottom_listwrap > .left_content,
        html.dcui-enabled.dcui-page-view #bottom_listwrap > .left_content > article,
        html.dcui-enabled.dcui-page-view #bottom_listwrap .gall_listwrap {
          margin-top: 0 !important;
          padding-top: 0 !important;
        }
        html.dcui-enabled .dcui-comments {
          border-top: 0;
        }
        html.dcui-enabled .dcui-comments .comment_count {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 4px 12px;
          min-height: 38px;
          height: auto;
          padding: 8px 12px;
          border: 1px solid var(--dcui-color-border) !important;
          border-radius: 4px;
          background: linear-gradient(to bottom, var(--dcui-color-control-gradient-top) 0, var(--dcui-color-control-gradient-soft-bottom) 100%);
          color: var(--dcui-color-text-soft);
          font-size: 13px;
          line-height: 20px;
        }
        html.dcui-enabled .dcui-comments .comment_count::after {
          display: none;
        }
        html.dcui-enabled .dcui-comments .comment_count > .num_box,
        html.dcui-enabled .dcui-comments .comment_count > .fr {
          float: none;
          width: auto;
          line-height: 20px;
        }
        html.dcui-enabled .dcui-comments .comment_count .comment_sort {
          display: inline-flex;
          align-items: center;
          vertical-align: middle;
          line-height: 20px;
        }
        html.dcui-enabled .dcui-comments .comment_sort .radiobox {
          display: inline-flex;
          align-items: center;
          height: 20px;
          line-height: 20px;
        }
        html.dcui-enabled .dcui-comments .comment_sort .checkmark {
          top: 50%;
          transform: translateY(-50%);
        }
        html.dcui-enabled .dcui-comments .comment_box {
          border-top: 0 !important;
        }
        html.dcui-enabled .dcui-comments .nomem_comment_info {
          display: block !important;
          float: none !important;
          clear: both;
          box-sizing: border-box;
          width: 100% !important;
          margin-right: 0 !important;
          margin-left: 0 !important;
          text-align: center !important;
        }
        html.dcui-enabled .dcui-comments .repley_add_vote {
          display: none !important;
        }
      `;
      document.documentElement.appendChild(style);
    },
  });

  const SelectionSearchController = Object.freeze({
    mount(context) {
      if (document.getElementById("dcui-selection-search")) return;
      const menu = document.createElement("div");
      menu.id = "dcui-selection-search";
      menu.setAttribute("role", "group");
      menu.setAttribute("aria-label", "선택한 글자 검색");
      menu.hidden = true;
      const galleryLink = document.createElement("a");
      galleryLink.id = "dcui-selection-gallery-search";
      galleryLink.textContent = "갤러리 검색";
      galleryLink.setAttribute("aria-label", "선택한 글자를 현재 갤러리에서 검색");
      menu.append(galleryLink);
      document.body.appendChild(menu);

      const style = document.createElement("style");
      style.id = "dcui-selection-search-style";
      style.textContent = `
        #dcui-selection-search[hidden] { display: none !important; }
        html:not(.dcui-enabled) #dcui-selection-search { display: none !important; }
        html.dcui-enabled #dcui-selection-search {
          position: fixed;
          z-index: 2147483646;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          border: 1px solid var(--dcui-color-border-strong);
          border-radius: 4px;
          background: var(--dcui-color-surface);
          color: var(--dcui-color-text-strong);
          box-shadow: 0 2px 9px rgba(0, 0, 0, .18);
          font: 12px/18px Arial, sans-serif;
          overflow: hidden;
        }
        html.dcui-enabled #dcui-selection-search a {
          display: block;
          padding: 5px 9px;
          color: inherit;
          text-decoration: none;
          white-space: nowrap;
          cursor: pointer;
        }
        html.dcui-enabled #dcui-selection-search a:hover,
        html.dcui-enabled #dcui-selection-search a:focus-visible {
          color: var(--dcui-color-accent);
          background: var(--dcui-color-surface-hover);
        }
      `;
      document.documentElement.appendChild(style);

      const hide = () => { menu.hidden = true; };
      const update = () => {
        hide();
        if (!document.documentElement.classList.contains("dcui-enabled")) return;
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
        const keyword = selection.toString().replace(/\s+/g, " ").trim();
        if (!keyword || keyword.length > 100) return;
        const range = selection.getRangeAt(0);
        const parent = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        if (!parent?.isConnected || !document.body.contains(parent)
          || parent.closest("input, textarea, select, [contenteditable], #dcui-selection-search")) return;
        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) return;

        const galleryUrl = new URL(context.urls.list);
        galleryUrl.searchParams.set("s_type", "search_subject_memo");
        galleryUrl.searchParams.set("s_keyword", keyword);
        galleryLink.href = galleryUrl.href;
        menu.hidden = false;
        const bounds = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(rect.right + 6, innerWidth - bounds.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - bounds.height - 8))}px`;
      };
      document.addEventListener("mouseup", (event) => {
        if (event.button === 0) requestAnimationFrame(update);
      });
      document.addEventListener("keyup", (event) => {
        if (event.key.startsWith("Arrow") || event.key === "Shift") requestAnimationFrame(update);
      });
      document.addEventListener("mousedown", (event) => {
        if (!menu.contains(event.target)) hide();
      });
      document.addEventListener("contextmenu", hide);
      window.addEventListener("scroll", hide, true);
      window.addEventListener("resize", hide);
    },
  });

  const IdentifierSearchController = Object.freeze({
    mount(context) {
      if (document.getElementById("dcui-identifier-search-style")) return;
      const listUrl = new URL(context.urls.list);
      const galleryId = listUrl.searchParams.get("id");
      if (!galleryId) return;
      const galleryPath = listUrl.pathname;
      const historyIndexKey = "dcui:writer-search-index-v1";
      const identityLabel = (name, value) => name && name !== value ? `${name} (${value})` : value;
      const searchKey = (identity) => `dcui:writer-search-v1:${JSON.stringify([
        galleryPath, galleryId, identity.kind, identity.value,
      ])}`;
      const readIndex = () => {
        const index = GM_getValue(historyIndexKey, []);
        return Array.isArray(index) ? index.filter((entry) => entry && typeof entry.key === "string") : [];
      };
      const galleryHistory = () => readIndex().filter((entry) =>
        entry.path === galleryPath && entry.galleryId === galleryId);
      const readSearch = (identity) => {
        const saved = GM_getValue(searchKey(identity), null);
        return saved && Number.isSafeInteger(saved.nextPage) && saved.nextPage >= 1
          && Array.isArray(saved.posts) ? saved : null;
      };
      let historyButton = null;
      const syncHistoryCard = () => {
        if (!historyButton) return;
        renderHistory();
      };
      const saveSearch = (identity, session) => {
        const key = searchKey(identity);
        GM_setValue(key, { nextPage: session.nextPage, exhausted: session.exhausted,
          newestPostNo: session.newestPostNo, refreshState: session.refreshState, posts: session.posts });
        const index = readIndex();
        const entries = [{ key, path: galleryPath, galleryId, kind: identity.kind,
          value: identity.value, name: identity.name, count: session.posts.length,
          lastPage: session.nextPage - 1, updatedAt: Date.now() },
          ...index.filter((entry) => entry.key !== key)];
        for (const old of entries.slice(50)) GM_deleteValue(old.key);
        GM_setValue(historyIndexKey, entries.slice(0, 50));
        syncHistoryCard();
      };
      const style = document.createElement("style");
      style.id = "dcui-identifier-search-style";
      style.textContent = `
        html:not(.dcui-enabled) #dcui-identifier-search { display: none !important; }
        html.dcui-enabled .dcui-user-identifier[role="button"] { cursor: pointer; pointer-events: auto; }
        html.dcui-enabled .dcui-user-identifier[role="button"]:hover,
        html.dcui-enabled .dcui-user-identifier[role="button"]:focus-visible { text-decoration: underline; }
        html.dcui-enabled .dcui-identifier-menu-item .dcui-user-identifier { display: none !important; }
        #dcui-identifier-search { position: fixed; z-index: 2147483645; inset: 0; display: grid;
          place-items: center; padding: 16px; box-sizing: border-box; background: rgba(0,0,0,.42); }
        #dcui-identifier-search .dcui-identifier-panel { box-sizing: border-box; width: min(560px, 100%);
          height: min(680px, 100%); display: flex; flex-direction: column; overflow: hidden;
          border: 1px solid var(--dcui-color-border-strong); border-radius: 8px;
          background: var(--dcui-color-surface); color: var(--dcui-color-text-strong);
          box-shadow: 0 12px 36px rgba(0,0,0,.25); font: 13px/1.45 Arial, sans-serif; }
        #dcui-identifier-search .dcui-identifier-head { display: flex; align-items: center;
          justify-content: space-between; min-height: 54px; padding: 0 16px 0 20px;
          border-bottom: 1px solid var(--dcui-color-border-soft); }
        #dcui-identifier-search .dcui-identifier-heading { display: flex; align-items: baseline;
          gap: 8px; min-width: 0; }
        #dcui-identifier-search h2 { flex: none; margin: 0; font-size: 16px; font-weight: 700; }
        #dcui-identifier-search .dcui-identifier-target { min-width: 0; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap; color: var(--dcui-color-muted); font-size: 12px; }
        #dcui-identifier-search .dcui-identifier-close { width: 32px; height: 32px; padding: 0;
          border: 0; border-radius: 4px; background: transparent; color: var(--dcui-color-text-soft);
          font: 22px/32px Arial, sans-serif; cursor: pointer; }
        #dcui-identifier-search .dcui-identifier-close:hover,
        #dcui-identifier-search .dcui-identifier-close:focus-visible { background: var(--dcui-color-surface-hover);
          color: var(--dcui-color-text-strong); }
        #dcui-identifier-search .dcui-identifier-filter { position: relative; z-index: 1;
          display: flex; align-items: center; gap: 8px; flex: none; padding: 10px 20px;
          border-bottom: 1px solid var(--dcui-color-border-soft); }
        #dcui-identifier-search .dcui-identifier-filter input,
        #dcui-identifier-search .dcui-identifier-sort-trigger { box-sizing: border-box; height: 32px;
          padding: 0 10px; border: 1px solid var(--dcui-color-border-strong); border-radius: 4px;
          background: var(--dcui-color-surface); color: var(--dcui-color-text-strong);
          font: 12px var(--dcui-font); }
        #dcui-identifier-search .dcui-identifier-filter input { flex: 1; min-width: 0; }
        #dcui-identifier-search .dcui-identifier-sort { position: relative; flex: none; width: 124px; }
        #dcui-identifier-search .dcui-identifier-sort-trigger { width: 100%; text-align: left; cursor: pointer; }
        #dcui-identifier-search .dcui-identifier-sort-trigger::after { content: ""; float: right;
          margin-top: 3px; border: 4px solid transparent; border-top-color: currentColor;
          transform: translateY(3px); }
        #dcui-identifier-search .dcui-identifier-sort-menu { position: absolute; top: calc(100% + 4px);
          right: 0; width: 100%; box-sizing: border-box; padding: 4px 0;
          border: 1px solid var(--dcui-color-border-strong); border-radius: 4px;
          background: var(--dcui-color-surface); box-shadow: 0 6px 16px rgba(0,0,0,.18); }
        #dcui-identifier-search .dcui-identifier-sort-menu[hidden] { display: none !important; }
        #dcui-identifier-search .dcui-identifier-sort-menu button { display: block; width: 100%;
          padding: 7px 10px; border: 0; background: transparent; color: var(--dcui-color-text-strong);
          font: 12px var(--dcui-font); text-align: left; cursor: pointer; }
        #dcui-identifier-search .dcui-identifier-sort-menu button:hover,
        #dcui-identifier-search .dcui-identifier-sort-menu button:focus-visible,
        #dcui-identifier-search .dcui-identifier-sort-menu button[aria-checked="true"] {
          background: var(--dcui-color-surface-hover); }
        #dcui-identifier-search .dcui-identifier-filter input::placeholder { color: var(--dcui-color-muted); }
        #dcui-identifier-search .dcui-identifier-filter input:focus-visible,
        #dcui-identifier-search .dcui-identifier-sort-trigger:focus-visible {
          outline: 2px solid var(--dcui-color-accent); outline-offset: 1px; }
        #dcui-identifier-search .dcui-identifier-results { flex: 1 1 auto; overflow: auto; min-height: 0;
          margin: 0; padding: 0; list-style: none; }
        #dcui-identifier-search .dcui-identifier-results:not(:has(li:not([hidden]))) { display: none; }
        #dcui-identifier-search .dcui-identifier-results li { display: flex; flex-direction: column;
          gap: 3px; min-height: 48px; padding: 7px 20px; box-sizing: border-box;
          border-bottom: 1px solid var(--dcui-color-border-soft); }
        #dcui-identifier-search .dcui-identifier-results li[hidden] { display: none !important; }
        #dcui-identifier-search .dcui-identifier-results li:hover { background: var(--dcui-color-surface-hover); }
        #dcui-identifier-search .dcui-identifier-main,
        #dcui-identifier-search .dcui-identifier-meta { display: flex; align-items: center;
          width: 100%; min-width: 0; gap: 7px; }
        #dcui-identifier-search .dcui-identifier-main { gap: 3px; }
        #dcui-identifier-search .dcui-identifier-results a { flex: 0 1 auto; min-width: 0; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap; color: var(--dcui-color-text-strong); text-decoration: none; }
        #dcui-identifier-search .dcui-identifier-results a:hover { color: var(--dcui-color-accent); }
        #dcui-identifier-search .dcui-identifier-results .icon_img { flex: none; vertical-align: -2px; }
        #dcui-identifier-search .dcui-identifier-replies { flex: none; color: var(--dcui-color-accent);
          font-size: 11px; }
        #dcui-identifier-search .dcui-identifier-meta small { min-width: 0; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap; color: var(--dcui-color-muted); font-size: 11px; }
        #dcui-identifier-search .dcui-identifier-stats { margin-left: auto; flex: none;
          color: var(--dcui-color-muted); font-size: 11px; }
        #dcui-identifier-search .dcui-identifier-empty { display: grid; flex: 1 1 auto; place-items: center;
          min-height: 0; padding: 16px; color: var(--dcui-color-muted); }
        #dcui-identifier-search .dcui-identifier-empty[hidden] { display: none !important; }
        #dcui-identifier-search .dcui-identifier-foot { display: flex; align-items: center;
          justify-content: space-between; gap: 12px; min-height: 40px; padding: 0 20px;
          color: var(--dcui-color-muted); font-size: 11px; }
        #dcui-identifier-search .dcui-identifier-count { color: var(--dcui-color-text-strong); font-size: 12px; }
        #dcui-identifier-search .dcui-identifier-actions { display: flex; gap: 8px; padding: 0 20px 12px; }
        #dcui-identifier-search .dcui-identifier-actions button { padding: 8px 12px;
          border: 1px solid var(--dcui-color-border-strong); border-radius: 4px;
          background: var(--dcui-color-surface); color: var(--dcui-color-text-strong); cursor: pointer; }
        #dcui-identifier-search .dcui-identifier-actions button:hover { background: var(--dcui-color-surface-hover); }
        #dcui-identifier-search .dcui-identifier-actions button[hidden] { display: none !important; }
        #dcui-identifier-search .dcui-identifier-actions button:disabled { cursor: default; opacity: .5; }
        #dcui-identifier-search .dcui-identifier-stop { margin-left: auto; }
        #dcui-identifier-search .dcui-identifier-progress { height: 3px; background: var(--dcui-color-border-soft); }
        #dcui-identifier-search .dcui-identifier-progress > span { display: block; height: 100%; width: 0;
          background: var(--dcui-color-accent); transition: width .2s ease; }
        html.dcui-enabled #dcui-sidebar .dcui-side-card.dcui-gallery-settings:has(+ .dcui-search-history-card) {
          margin-bottom: 0; border-bottom: 0; }
        #dcui-sidebar .dcui-search-history-collapsed > .dcui-side-title { border-bottom: 0; }
        #dcui-sidebar .dcui-search-history-body[hidden] { display: none !important; }
        #dcui-sidebar .dcui-author-search-form { display: flex; gap: 5px; margin: 0; padding: 8px;
          border-bottom: 1px solid var(--dcui-color-border); }
        #dcui-sidebar .dcui-author-search-form input { flex: 1; min-width: 0; height: 28px;
          padding: 0 6px; border: 1px solid var(--dcui-color-border-strong);
          background: var(--dcui-color-surface); color: var(--dcui-color-text-strong);
          font: 11px var(--dcui-font); }
        #dcui-sidebar .dcui-author-search-form input::placeholder { color: var(--dcui-color-muted); }
        #dcui-sidebar .dcui-author-search-form button { flex: none; height: 28px; padding: 0 8px;
          border: 1px solid var(--dcui-color-border-strong); background: var(--dcui-color-surface-muted);
          color: var(--dcui-color-text-strong); font: 11px var(--dcui-font); cursor: pointer; }
        #dcui-sidebar .dcui-author-search-form button:hover { color: var(--dcui-color-link); }
        #dcui-sidebar .dcui-author-search-form:has(+ .dcui-history-list[hidden]) { border-bottom: 0; }
        #dcui-sidebar .dcui-history-list[hidden] { display: none !important; }
        #dcui-sidebar .dcui-history-list { max-height: 360px; overflow-y: auto;
          margin: 0; padding: 0; list-style: none; }
        #dcui-sidebar .dcui-history-list li { display: flex; align-items: center;
          min-height: 48px; padding: 0 5px 0 9px; border-bottom: 1px solid var(--dcui-color-border); }
        #dcui-sidebar .dcui-history-list li:last-child { border-bottom: 0; }
        #dcui-sidebar .dcui-history-entry { display: flex; flex: 1; flex-direction: column;
          min-width: 0; padding: 8px 0; border: 0; background: transparent;
          color: var(--dcui-color-text-soft); font: 11px/1.4 var(--dcui-font);
          text-align: left; cursor: pointer; }
        #dcui-sidebar .dcui-history-entry strong,
        #dcui-sidebar .dcui-history-entry small { display: block; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap; }
        #dcui-sidebar .dcui-history-entry small { color: var(--dcui-color-muted); font-size: 10px; }
        #dcui-sidebar .dcui-history-delete { flex: none; width: 24px; height: 30px; padding: 0; border: 0;
          background: transparent; color: var(--dcui-color-muted); cursor: pointer; }
        #dcui-sidebar .dcui-history-list li:hover { background: var(--dcui-color-surface-muted); }
        #dcui-sidebar .dcui-history-entry:hover,
        #dcui-sidebar .dcui-history-delete:hover { color: var(--dcui-color-link); }
      `;
      document.documentElement.appendChild(style);

      let active = null;
      const runningSearches = new Map();
      const close = () => {
        if (!active) return;
        if (!active.running) active.controller.abort();
        active.root.remove();
        active = null;
      };
      const renderHistory = () => {
        const list = historyButton?.closest(".dcui-search-history-card")?.querySelector(".dcui-history-list");
        if (!list) return;
        list.replaceChildren();
        const entries = galleryHistory();
        list.hidden = !entries.length;
        for (const entry of entries) {
          const item = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.className = "dcui-history-entry";
          const title = document.createElement("strong");
          title.textContent = identityLabel(entry.name, entry.value);
          const detail = document.createElement("small");
          detail.textContent = `${entry.kind === "ip" ? "IP" : "식별코드"} · ${entry.lastPage || 0}페이지 · ${entry.count || 0}건`;
          button.append(title, detail);
          button.addEventListener("click", () => open({ kind: entry.kind, value: entry.value,
            name: entry.name || entry.value }));
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "dcui-history-delete";
          remove.textContent = "×";
          remove.setAttribute("aria-label", `${entry.name || entry.value} 검색 기록 삭제`);
          remove.addEventListener("click", () => {
            GM_deleteValue(entry.key);
            GM_setValue(historyIndexKey, readIndex().filter((stored) => stored.key !== entry.key));
            syncHistoryCard();
          });
          item.append(button, remove);
          list.appendChild(item);
        }
      };
      const open = (identity, refreshRequested = false) => {
        close();
        const running = runningSearches.get(searchKey(identity));
        if (running) {
          active = running;
          document.body.appendChild(running.root);
          running.root.querySelector(".dcui-identifier-close").focus();
          return;
        }
        const saved = readSearch(identity);
        const root = document.createElement("div");
        root.id = "dcui-identifier-search";
        root.innerHTML = `<section class="dcui-identifier-panel" role="dialog" aria-modal="true" aria-labelledby="dcui-identifier-title">
          <div class="dcui-identifier-head"><div class="dcui-identifier-heading"><h2 id="dcui-identifier-title">식별코드 검색</h2><span class="dcui-identifier-target"></span></div><button type="button" class="dcui-identifier-close" aria-label="닫기">×</button></div>
          <div class="dcui-identifier-filter"><input type="search" aria-label="찾은 글 제목 검색" placeholder="찾은 글 제목 검색" autocomplete="off">
            <div class="dcui-identifier-sort"><button type="button" class="dcui-identifier-sort-trigger"
              aria-label="검색 결과 정렬: 최신순" aria-haspopup="menu" aria-expanded="false" aria-controls="dcui-identifier-sort-menu">최신순</button>
              <div id="dcui-identifier-sort-menu" class="dcui-identifier-sort-menu" role="menu" aria-label="검색 결과 정렬" hidden>
                <button type="button" role="menuitemradio" aria-checked="true" data-sort="newest">최신순</button>
                <button type="button" role="menuitemradio" aria-checked="false" data-sort="oldest">오래된순</button>
                <button type="button" role="menuitemradio" aria-checked="false" data-sort="views">조회순</button>
                <button type="button" role="menuitemradio" aria-checked="false" data-sort="recommendations">추천순</button>
                <button type="button" role="menuitemradio" aria-checked="false" data-sort="replies">댓글순</button>
              </div></div></div>
          <ol class="dcui-identifier-results"></ol><div class="dcui-identifier-empty">검색 중…</div>
          <div class="dcui-identifier-foot"><span class="dcui-identifier-status" role="status">0 / 200페이지</span>
            <strong class="dcui-identifier-count">0건</strong></div>
          <div class="dcui-identifier-actions"><button type="button" class="dcui-identifier-refresh" hidden>새 글 확인</button>
            <button type="button" class="dcui-identifier-more" hidden>더 검색하기</button>
            <button type="button" class="dcui-identifier-stop" hidden>중단</button></div>
          <div class="dcui-identifier-progress" aria-hidden="true"><span></span></div>
        </section>`;
        root.querySelector("#dcui-identifier-title").textContent = identity.kind === "ip" ? "IP 검색" : "식별코드 검색";
        root.querySelector(".dcui-identifier-target").textContent = identityLabel(identity.name, identity.value);
        const status = root.querySelector(".dcui-identifier-status");
        const results = root.querySelector(".dcui-identifier-results");
        const titleFilter = root.querySelector(".dcui-identifier-filter input");
        const sortControl = root.querySelector(".dcui-identifier-sort");
        const sortTrigger = sortControl.querySelector(".dcui-identifier-sort-trigger");
        const sortMenu = sortControl.querySelector(".dcui-identifier-sort-menu");
        const sortOptions = [...sortMenu.querySelectorAll("[data-sort]")];
        let sortMode = "newest";
        const empty = root.querySelector(".dcui-identifier-empty");
        const count = root.querySelector(".dcui-identifier-count");
        const progress = root.querySelector(".dcui-identifier-progress > span");
        const refreshButton = root.querySelector(".dcui-identifier-refresh");
        const more = root.querySelector(".dcui-identifier-more");
        const stopButton = root.querySelector(".dcui-identifier-stop");
        const session = { root, controller: new AbortController(), nextPage: saved?.nextPage || 1,
          found: new Set(), posts: [], exhausted: saved?.exhausted === true, running: false,
          newestPostNo: Number(saved?.newestPostNo) || 0,
          refreshState: saved?.refreshState?.page >= 1 ? saved.refreshState : null };
        active = session;
        const dateValue = (post) => {
          const match = String(post.date || "").match(/(\d{4})[.-](\d{1,2})[.-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
          return match ? Number(match.slice(1, 7).map((part, index) =>
            String(part || 0).padStart(index === 0 ? 4 : 2, "0")).join("")) : 0;
        };
        const countValue = (value) => {
          const match = String(value || "").trim().replace(/,/g, "").match(/^([\d.]+)\s*(억|만|천)?$/);
          return match ? (Number(match[1]) || 0) * ({ 억: 1e8, 만: 1e4, 천: 1e3 }[match[2]] || 1) : 0;
        };
        const sortPosts = () => {
          session.posts.sort((a, b) => Number(b.no) - Number(a.no));
          const byNo = new Map(session.posts.map((post) => [post.no, post]));
          const mode = sortMode;
          const sorted = [...results.children].sort((left, right) => {
            const a = byNo.get(left.dataset.no);
            const b = byNo.get(right.dataset.no);
            if (mode === "newest" || mode === "oldest") {
              const aDate = dateValue(a);
              const bDate = dateValue(b);
              if (aDate && bDate && aDate !== bDate) {
                return mode === "oldest" ? aDate - bDate : bDate - aDate;
              }
              return mode === "oldest" ? Number(a.no) - Number(b.no) : Number(b.no) - Number(a.no);
            }
            const metric = mode === "views" ? "views" : mode === "replies" ? "replies" : "recommendations";
            const value = (post) => metric === "replies"
              ? countValue(post.replies) + countValue(post.voiceReplies) : countValue(post[metric]);
            return value(b) - value(a) || Number(b.no) - Number(a.no);
          });
          const fragment = document.createDocumentFragment();
          for (const item of sorted) fragment.appendChild(item);
          results.replaceChildren(fragment);
        };
        const closeSortMenu = () => {
          sortMenu.hidden = true;
          sortTrigger.setAttribute("aria-expanded", "false");
        };
        const openSortMenu = () => {
          sortMenu.hidden = false;
          sortTrigger.setAttribute("aria-expanded", "true");
        };
        sortTrigger.addEventListener("click", () => {
          if (sortMenu.hidden) openSortMenu();
          else closeSortMenu();
        });
        sortMenu.addEventListener("click", (event) => {
          const option = event.target.closest("[data-sort]");
          if (!option || !sortMenu.contains(option)) return;
          sortMode = option.dataset.sort;
          sortTrigger.textContent = option.textContent;
          sortTrigger.setAttribute("aria-label", `검색 결과 정렬: ${option.textContent}`);
          for (const item of sortOptions) item.setAttribute("aria-checked", String(item === option));
          sortPosts();
          closeSortMenu();
          sortTrigger.focus();
        });
        sortTrigger.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openSortMenu();
          sortOptions.find((item) => item.dataset.sort === sortMode).focus();
        });
        sortMenu.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeSortMenu();
            sortTrigger.focus();
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const index = sortOptions.indexOf(document.activeElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? sortOptions.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + sortOptions.length) % sortOptions.length;
            sortOptions[next].focus();
          }
        });
        sortControl.addEventListener("focusout", (event) => {
          if (!sortControl.contains(event.relatedTarget)) closeSortMenu();
        });
        root.addEventListener("pointerdown", (event) => {
          if (!sortControl.contains(event.target)) closeSortMenu();
        });
        const applyTitleFilter = () => {
          const query = titleFilter.value.trim().toLocaleLowerCase();
          let shown = 0;
          for (const item of results.children) {
            const matches = !query || item.querySelector("a")?.textContent.toLocaleLowerCase().includes(query);
            item.hidden = !matches;
            if (matches) shown++;
          }
          count.textContent = query ? `${shown} / ${session.found.size}건` : `${session.found.size}건`;
          if (query) {
            empty.hidden = shown > 0;
            if (!shown) empty.textContent = "제목 검색 결과 없음";
          } else {
            empty.hidden = session.found.size > 0;
            if (!session.found.size) empty.textContent = session.running ? "검색 중…" : "검색 결과 없음";
          }
        };
        titleFilter.addEventListener("input", applyTitleFilter);
        const addPost = (post) => {
          if (!post || typeof post.no !== "string" || !/^\d+$/.test(post.no)
            || typeof post.href !== "string") return;
          if (identity.kind === "uid" && post.name && (!identity.name || identity.name === identity.value)) {
            identity.name = post.name;
            root.querySelector(".dcui-identifier-target").textContent = identityLabel(identity.name, identity.value);
          }
          let href;
          try { href = new URL(post.href, listUrl); } catch { return; }
          if (href.origin !== listUrl.origin || href.searchParams.get("id") !== galleryId
            || !href.pathname.includes("/board/view")) return;
          const icons = Array.isArray(post.icons) ? post.icons.filter((icon) => /^icon_[a-z0-9_]+$/.test(icon)) : [];
          if (post.concept && !icons.some((icon) => icon.startsWith("icon_recom"))) icons.unshift("icon_recomtxt");
          const normalized = { no: post.no, href: href.href, title: post.title || `게시글 ${post.no}`,
            date: post.date || "", name: post.name || "", icons,
            views: post.views || "0", recommendations: post.recommendations || "0",
            replies: Number(post.replies) || 0, voiceReplies: Number(post.voiceReplies) || 0,
            concept: post.concept === true };
          const existingIndex = session.posts.findIndex((entry) => entry.no === post.no);
          if (existingIndex < 0) {
            session.found.add(post.no);
            session.posts.push(normalized);
          } else {
            session.posts[existingIndex] = normalized;
          }
          const item = [...results.children].find((entry) => entry.dataset.no === post.no)
            || document.createElement("li");
          item.dataset.no = post.no;
          item.replaceChildren();
          const main = document.createElement("div");
          main.className = "dcui-identifier-main gall_tit";
          const link = document.createElement("a");
          link.href = href.href;
          for (const icon of icons) {
            const marker = document.createElement("em");
            marker.className = `icon_img ${icon}${icon.startsWith("icon_recom") ? " dcui-identifier-concept" : ""}`;
            if (icon.startsWith("icon_recom")) marker.setAttribute("aria-label", "념글");
            link.appendChild(marker);
          }
          link.appendChild(document.createTextNode(post.title || `게시글 ${post.no}`));
          main.appendChild(link);
          if (normalized.replies > 0 || normalized.voiceReplies > 0) {
            const replies = document.createElement("span");
            replies.className = "dcui-identifier-replies";
            replies.textContent = `[${normalized.replies}${normalized.voiceReplies ? `/${normalized.voiceReplies}` : ""}]`;
            replies.setAttribute("aria-label",
              `댓글 ${normalized.replies}개${normalized.voiceReplies ? `, 보이스리플 ${normalized.voiceReplies}개` : ""}`);
            main.appendChild(replies);
          }
          const meta = document.createElement("div");
          meta.className = "dcui-identifier-meta";
          if (post.name) {
            const name = document.createElement("small");
            name.textContent = post.name;
            meta.appendChild(name);
          }
          const date = document.createElement("small");
          date.textContent = post.date || "";
          meta.appendChild(date);
          const stats = document.createElement("span");
          stats.className = "dcui-identifier-stats";
          stats.textContent = `조회 ${normalized.views} · 추천 ${normalized.recommendations}`;
          meta.appendChild(stats);
          item.append(main, meta);
          if (!item.isConnected) results.appendChild(item);
          applyTitleFilter();
        };
        for (const post of saved?.posts || []) addPost(post);
        sortPosts();
        if (saved) {
          refreshButton.hidden = false;
          const lastPage = session.nextPage - 1;
          const limit = Math.ceil(Math.max(1, lastPage) / 200) * 200;
          status.textContent = session.refreshState
            ? `새 글 확인 ${session.refreshState.page - 1}페이지까지 · 계속 확인 필요`
            : session.exhausted || lastPage === limit
              ? `${lastPage}페이지 확인 완료` : `${lastPage} / ${limit}페이지`;
          progress.style.width = `${lastPage ? ((lastPage - 1) % 200 + 1) / 2 : 0}%`;
          if (!session.found.size && !titleFilter.value.trim()) empty.textContent = "검색 결과 없음";
          more.textContent = lastPage === limit ? "더 검색하기" : "이어서 검색";
          more.hidden = session.exhausted || Boolean(session.refreshState);
          if (session.refreshState) refreshButton.textContent = "계속 확인";
        }
        const fetchBatch = (pages, runSignal) => AutomatedRequestCoordinator.run(async (signal) => {
          if (session.controller.signal.aborted || runSignal.aborted)
            throw new DOMException("검색이 중단되었습니다.", "AbortError");
          const request = new AbortController();
          const abort = () => request.abort();
          signal.addEventListener("abort", abort, { once: true });
          session.controller.signal.addEventListener("abort", abort, { once: true });
          runSignal.addEventListener("abort", abort, { once: true });
          const requests = pages.map(async (page) => {
            const url = new URL(listUrl.pathname, listUrl.origin);
            url.searchParams.set("id", galleryId);
            url.searchParams.set("list_num", "100");
            url.searchParams.set("page", String(page));
            const response = await fetch(url.href, { credentials: "same-origin", signal: request.signal });
            if (!response.ok) throw new Error(`목록 응답 ${response.status}`);
            const html = AutomatedRequestCoordinator.requireNonEmpty(await response.text());
            return { page, url, html };
          });
          try {
            return await Promise.all(requests);
          } catch (error) {
            request.abort();
            await Promise.allSettled(requests);
            throw error;
          } finally {
            signal.removeEventListener("abort", abort);
            session.controller.signal.removeEventListener("abort", abort);
            runSignal.removeEventListener("abort", abort);
          }
        }, { automatedGapMs: 200, navigationGapMs: 0 });
        const parsePost = (row, url) => {
          const writer = row.querySelector(".gall_writer.ub-writer");
          if (identity.kind === "uid"
            ? writer?.dataset.uid?.trim() !== identity.value
            : writer?.dataset.uid?.trim() || writer?.dataset.ip?.trim() !== identity.value) return null;
          const no = row.dataset.no;
          const titleLink = row.querySelector(".gall_tit a[href*='/board/view']");
          if (!no || !titleLink) return null;
          const postUrl = new URL(titleLink.getAttribute("href"), url);
          if (postUrl.origin !== listUrl.origin || postUrl.searchParams.get("id") !== galleryId) return null;
          const replyParts = row.querySelector(".gall_tit .reply_num")?.textContent.match(/\[?(\d+)(?:\/(\d+))?/);
          const replies = Number(replyParts?.[1]) || 0;
          const voiceReplies = Number(replyParts?.[2]) || 0;
          const concept = row.dataset.type?.startsWith("icon_recom")
            || Boolean(row.querySelector(".gall_tit .icon_img[class*='icon_recom']"));
          const icons = [...titleLink.querySelectorAll(".icon_img")]
            .flatMap((icon) => [...icon.classList].filter((name) => /^icon_[a-z0-9_]+$/.test(name) && name !== "icon_img"));
          if (!icons.length && /^icon_[a-z0-9_]+$/.test(row.dataset.type || "")) icons.push(row.dataset.type);
          return { no, href: postUrl.href, title: titleLink.textContent.trim(),
            name: writer?.dataset.nick?.trim() || "",
            date: row.querySelector(".gall_date")?.getAttribute("title") || "", replies, voiceReplies,
            concept, icons,
            views: row.querySelector(".gall_count")?.textContent.trim() || "0",
            recommendations: row.querySelector(".gall_recommend")?.textContent.trim() || "0" };
        };
        const persist = () => {
          try { saveSearch(identity, session); } catch (error) {
            console.warn("[DC UI] 작성자 검색 기록 저장 실패:", error);
          }
        };
        const ordinaryPostNumbers = (rows) => rows
          .filter((row) => !row.dataset.type?.startsWith("icon_notice"))
          .map((row) => Number(row.dataset.no))
          .filter((no) => Number.isSafeInteger(no) && no > 0);
        const refresh = async () => {
          if (session.running || session.controller.signal.aborted) return;
          AutomatedRequestCoordinator.resetLifecycle();
          session.running = true;
          runningSearches.set(searchKey(identity), session);
          const runController = new AbortController();
          session.runController = runController;
          stopButton.hidden = false;
          stopButton.disabled = false;
          refreshButton.disabled = true;
          more.hidden = true;
          const savedPostNo = session.posts.reduce((max, post) => Math.max(max, Number(post.no) || 0), 0);
          const state = session.refreshState || { page: 1,
            boundaryNo: session.newestPostNo || savedPostNo, newestNo: 0 };
          session.refreshState = state;
          const limit = state.boundaryNo ? Infinity : state.page + 199;
          let failed = false;
          let completed = false;
          let checked = state.page - 1;
          try {
            for (let page = state.page; page <= limit; page += 5) {
              if (session.controller.signal.aborted) return;
              if (runController.signal.aborted) throw new DOMException("검색이 중단되었습니다.", "AbortError");
              const pages = Array.from({ length: Math.min(5, limit + 1 - page) }, (_, index) => page + index);
              status.textContent = `새 글 확인 ${pages[0]}–${pages.at(-1)}페이지`;
              const batch = await fetchBatch(pages, runController.signal);
              if (session.controller.signal.aborted) return;
              if (runController.signal.aborted) throw new DOMException("검색이 중단되었습니다.", "AbortError");
              let overlap = false;
              let reachedEnd = false;
              for (const { page: batchPage, url, html } of batch) {
                const doc = new DOMParser().parseFromString(html, "text/html");
                if (!doc.querySelector(".gall_listwrap")) throw new Error("갤러리 목록을 확인할 수 없습니다.");
                const rows = [...doc.querySelectorAll("tr.ub-content[data-no]")];
                if (!rows.length) { reachedEnd = true; break; }
                const postNumbers = ordinaryPostNumbers(rows);
                if (batchPage === 1 && postNumbers.length) state.newestNo = Math.max(...postNumbers);
                if (state.boundaryNo && postNumbers.some((no) => no <= state.boundaryNo)) overlap = true;
                for (const row of rows) {
                  const post = parsePost(row, url);
                  if (!post) continue;
                  addPost(post);
                }
                checked = batchPage;
              }
              state.page = checked + 1;
              sortPosts();
              persist();
              if (overlap || reachedEnd) {
                completed = true;
                session.newestPostNo = state.newestNo || session.newestPostNo;
                session.refreshState = null;
                persist();
                break;
              }
              if (page + 5 <= limit) await AutomatedRequestCoordinator.wait(200, runController.signal);
            }
          } catch (error) {
            if (session.controller.signal.aborted) return;
            failed = true;
            status.textContent = runController.signal.aborted ? `새 글 확인 중단 · ${checked}페이지 확인`
              : error instanceof EmptyAutomatedResponseError ? "빈 응답 · 검색 중단"
                : `검색 중단 · ${error.name === "AbortError" ? "요청 취소" : error.message}`;
          } finally {
            session.running = false;
            if (runningSearches.get(searchKey(identity)) === session) runningSearches.delete(searchKey(identity));
            if (session.runController === runController) session.runController = null;
            if (active === session) {
              stopButton.hidden = true;
              refreshButton.disabled = false;
              more.hidden = session.exhausted || Boolean(session.refreshState);
              refreshButton.textContent = session.refreshState ? "계속 확인" : "새 글 확인";
              if (!failed) status.textContent = completed
                ? `새 글 확인 완료 · ${checked}페이지 확인`
                : `새 글 확인 ${checked}페이지까지 · 계속 확인 필요`;
              if (!session.found.size && !titleFilter.value.trim()) empty.textContent = "검색 결과 없음";
            }
          }
        };
        const scan = async () => {
          if (session.running || session.exhausted || session.controller.signal.aborted) return;
          AutomatedRequestCoordinator.resetLifecycle();
          session.running = true;
          runningSearches.set(searchKey(identity), session);
          const runController = new AbortController();
          session.runController = runController;
          stopButton.hidden = false;
          stopButton.disabled = false;
          more.hidden = true;
          const limit = Math.ceil(session.nextPage / 200) * 200;
          let failed = false;
          let reachedEnd = false;
          try {
            while (session.nextPage <= limit) {
              if (session.controller.signal.aborted) return;
              if (runController.signal.aborted) throw new DOMException("검색이 중단되었습니다.", "AbortError");
              const pages = Array.from({ length: Math.min(5, limit + 1 - session.nextPage) },
                (_, index) => session.nextPage + index);
              status.textContent = `${pages[0]}–${pages.at(-1)} / ${limit}페이지`;
              const batch = await fetchBatch(pages, runController.signal);
              if (session.controller.signal.aborted) return;
              if (runController.signal.aborted) throw new DOMException("검색이 중단되었습니다.", "AbortError");
              for (const { page, url, html } of batch) {
                const doc = new DOMParser().parseFromString(html, "text/html");
                const rows = [...doc.querySelectorAll("tr.ub-content[data-no]")];
                if (!doc.querySelector(".gall_listwrap")) throw new Error("갤러리 목록을 확인할 수 없습니다.");
                if (!rows.length) {
                  status.textContent = `${page - 1}페이지 확인 완료`;
                  reachedEnd = true;
                  session.exhausted = true;
                  break;
                }
                if (page === 1) {
                  const postNumbers = ordinaryPostNumbers(rows);
                  if (postNumbers.length) session.newestPostNo = Math.max(...postNumbers);
                }
                for (const row of rows) {
                  const post = parsePost(row, url);
                  if (post && !session.found.has(post.no)) addPost(post);
                }
                session.nextPage = page + 1;
                status.textContent = `${page} / ${limit}페이지`;
                progress.style.width = `${((page - 1) % 200 + 1) / 2}%`;
              }
              sortPosts();
              persist();
              if (reachedEnd) break;
              if (session.nextPage <= limit) await AutomatedRequestCoordinator.wait(200, runController.signal);
            }
          } catch (error) {
            if (session.controller.signal.aborted) return;
            failed = true;
            status.textContent = runController.signal.aborted
              ? `${session.nextPage - 1}페이지에서 중단`
              : error instanceof EmptyAutomatedResponseError ? "빈 응답 · 검색 중단"
                : `검색 중단 · ${error.name === "AbortError" ? "요청 취소" : error.message}`;
            if (!session.found.size && !titleFilter.value.trim())
              empty.textContent = runController.signal.aborted ? "검색 결과 없음" : "검색 중단";
          } finally {
            session.running = false;
            if (runningSearches.get(searchKey(identity)) === session) runningSearches.delete(searchKey(identity));
            if (session.runController === runController) session.runController = null;
            if (active === session) {
              stopButton.hidden = true;
              if (runController.signal.aborted) {
                more.hidden = false;
                more.textContent = "이어서 검색";
              } else if (!failed && session.nextPage > limit) {
                status.textContent = `${limit}페이지 확인 완료`;
                more.hidden = false;
                more.textContent = "더 검색하기";
              }
              if (!session.found.size && !titleFilter.value.trim()) empty.textContent = "검색 결과 없음";
            }
          }
        };
        more.addEventListener("click", () => { void scan(); });
        refreshButton.addEventListener("click", () => { void refresh(); });
        stopButton.addEventListener("click", () => {
          if (!session.running || !session.runController) return;
          stopButton.disabled = true;
          session.runController.abort();
        });
        root.querySelector(".dcui-identifier-close").addEventListener("click", close);
        root.addEventListener("click", (event) => { if (event.target === root) close(); });
        document.body.appendChild(root);
        root.querySelector(".dcui-identifier-close").focus();
        if (!saved) void scan();
        else if (refreshRequested) void refresh();
      };
      let selectedIdentity = null;
      const decorateMenu = () => {
        if (!selectedIdentity) return;
        for (const menu of document.querySelectorAll(".user_data_list")) {
          const original = [...menu.children].find((item) =>
            item.querySelector(":scope > a")?.textContent.trim() === "작성글 검색");
          if (!original) continue;
          let item = menu.querySelector(":scope > .dcui-identifier-menu-item");
          if (!item) {
            item = document.createElement("li");
            item.className = "bg_grey dcui-identifier-menu-item";
            const link = document.createElement("a");
            link.href = "javascript:;";
            link.textContent = "식별코드 검색";
            const icon = document.createElement("em");
            icon.className = "sp_img icon_go";
            link.appendChild(icon);
            item.appendChild(link);
            link.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              const { searchKind: kind, searchValue: value, searchName: name } = item.dataset;
              if (!kind || !value) return;
              const popup = menu.closest(".user_data_lyr, .user_data");
              if (popup) popup.style.display = "none";
              open({ kind, value, name }, true);
            });
          }
          item.dataset.searchKind = selectedIdentity.kind;
          item.dataset.searchValue = selectedIdentity.value;
          item.dataset.searchName = selectedIdentity.name;
          item.querySelector(":scope > a").firstChild.textContent = selectedIdentity.kind === "ip" ? "IP 검색" : "식별코드 검색";
          if (original.nextElementSibling !== item) original.after(item);
        }
      };
      const menuObserver = new MutationObserver(decorateMenu);
      menuObserver.observe(document.body, { childList: true, subtree: true });
      const sidebar = document.getElementById("dcui-sidebar");
      if (sidebar && !sidebar.querySelector(".dcui-search-history-card")) {
        const card = document.createElement("section");
        card.className = "dcui-side-card dcui-search-history-card";
        card.innerHTML = `<div class="dcui-side-title"><strong>작성자 검색</strong>
          <button type="button" class="dcui-gallery-settings-toggle dcui-search-history-toggle" aria-controls="dcui-search-history-body">보이기</button></div>
          <div class="dcui-search-history-body" id="dcui-search-history-body">
            <form class="dcui-author-search-form"><input type="text" aria-label="식별코드 또는 IP" placeholder="식별코드·IP" autocomplete="off" required><button type="submit">검색</button></form>
            <ul class="dcui-history-list"></ul></div>`;
        (sidebar.querySelector(".dcui-gallery-settings") || sidebar.querySelector(".dcui-hotkeys"))?.after(card);
        historyButton = card.querySelector(".dcui-search-history-toggle");
        const body = card.querySelector(".dcui-search-history-body");
        const syncVisibility = (collapsed) => {
          card.classList.toggle("dcui-search-history-collapsed", collapsed);
          body.hidden = collapsed;
          historyButton.textContent = collapsed ? "보이기" : "숨기기";
          historyButton.setAttribute("aria-expanded", String(!collapsed));
        };
        syncVisibility(true);
        historyButton.addEventListener("click", () => {
          const collapsed = !card.classList.contains("dcui-search-history-collapsed");
          syncVisibility(collapsed);
        });
        card.querySelector(".dcui-author-search-form").addEventListener("submit", (event) => {
          event.preventDefault();
          const value = event.currentTarget.querySelector("input").value.trim();
          if (!value) return;
          const isIp = /^(?:\d{1,3}\.){1,3}\d{1,3}$/.test(value)
            || (value.includes(":") && /^[\da-f:]+$/i.test(value));
          open({ kind: isIp ? "ip" : "uid", value, name: value }, true);
        });
        syncHistoryCard();
      }
      document.addEventListener("click", (event) => {
        const writer = event.target.closest?.(".ub-writer[data-uid], .ub-writer[data-ip]");
        const uid = writer?.dataset.uid?.trim();
        const ip = writer?.dataset.ip?.trim();
        if ((!uid && !ip) || !document.documentElement.classList.contains("dcui-enabled")) return;
        const name = writer.dataset.nick?.trim() || writer.querySelector(".nickname")?.textContent.trim() || "";
        selectedIdentity = uid ? { kind: "uid", value: uid, name } : { kind: "ip", value: ip, name };
        if (event.target.closest(".dcui-user-identifier")) {
          event.preventDefault();
          event.stopPropagation();
          (writer.querySelector(".nickname em") || writer.querySelector(".nickname"))?.click();
        }
        window.setTimeout(decorateMenu, 0);
      }, true);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && active) close();
        if ((event.key === "Enter" || event.key === " ")
          && event.target.matches?.(".dcui-user-identifier")) {
          event.preventDefault();
          event.target.click();
        }
      });
    },
  });

  function releaseEarlyShield() {
    requestAnimationFrame(() => {
      earlyShieldObserver?.disconnect();
      document.documentElement.classList.remove("dcui-booting");
      earlyShield?.remove();
    });
  }

  function boot() {
    try {
      ThemeController.init(pageContext);

      const themeEnabled = ThemeController.isEnabled();
      if (themeEnabled) {
        CustomSettingsController.init();
        AutomatedRequestCoordinator.noteNavigation();
        syncConfiguredListLinks();
        ShellView.mount(pageContext);
        SelectionSearchController.mount(pageContext);
        IdentifierSearchController.mount(pageContext);
        void NativeAlarmInstall.apply();
        ListView.mount();
        ArticleView.mount(pageContext);
        ConceptAlarmController.mount(pageContext);
      }
    } finally {
      releaseEarlyShield();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

})();
