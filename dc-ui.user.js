// ==UserScript==
// @name         디시인사이드 UI 변경
// @namespace    https://gall.dcinside.com
// @version      2.0.0
// @description  갤러리 UI 변경, 즐겨찾기·최근 방문 통합, 단축키, 개념글 알림, 광고 숨김 등
// @author       rankingbot
// @license      MIT
// @homepageURL  https://sleazyfork.org/ko/scripts/581303
// @match        https://gall.dcinside.com/*/board/lists*
// @match        https://gall.dcinside.com/board/lists*
// @match        https://gall.dcinside.com/*/board/view*
// @match        https://gall.dcinside.com/board/view*
// @resource     dcfmk-fontawesome https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.6.0/fonts/fontawesome-webfont.woff2#sha256=c1732796c9dfafddff16db9660e67a879d723f376b0160cccad730c6c414eed3
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_getResourceURL
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      m.dcinside.com
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_VERSION = "2.0.0";
  const THEME_ENABLED_KEY = "dcfmk:enabled";
  const LIST_SIZE_PREFERENCE_KEY = "dcfmk:list-size-preference";
  const SETTINGS_COLLAPSED_KEY = "dcfmk:settings-collapsed";
  const GALLERY_COVER_HIDDEN_KEY = "dcfmk:gallery-cover-hidden";
  const USER_IDENTIFIER_VISIBLE_KEY = "dcfmk:user-identifier-visible";
  const CONCEPT_ALARM_ENABLED_KEY = "dcfmk:concept-alarm-enabled";
  const FAVORITE_SHORTCUT_CACHE_KEY = "dcfmk:favorite-shortcuts-cache";
  const FAVORITE_SHORTCUT_CACHE_READY_KEY = "dcfmk:favorite-shortcuts-cache-ready";
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
      const shortcut = url.pathname.match(/^\/(mini|mgallery|person)\/([^/]+)\/?$/);
      if (url.origin === location.origin && shortcut) {
        url.pathname = `/${shortcut[1]}/board/lists/`;
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
      "#dcfmk-gallery-strip a[href]",
      "#dcfmk-sidebar .dcfmk-favorite-shortcut a[href]",
      "#dcfmk-sidebar [data-role='sideConcept'][href]",
      ".dcfmk-board-nav a[href]",
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
      if (!document.documentElement.classList.contains("dcfmk-enabled")) return;
      if (event.type === "click" && event.button !== 0) return;
      if (event.type === "auxclick" && event.button !== 1) return;

      const control = event.target.closest?.("a[href], button[onclick*='goList']");
      if (!control || control.closest("#dcfmk-theme-toggle")) return;
      const rawHref = this.rawHrefFromControl(control);
      if (!rawHref || /^javascript:/i.test(rawHref) || rawHref.startsWith("#")) return;

      let originalUrl;
      try {
        originalUrl = new URL(rawHref, location.href);
      } catch (_error) {
        return;
      }
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
      if (!initialThemeEnabled || window.__dcfmkListNavigationBound) return;
      window.__dcfmkListNavigationBound = true;
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
  if (window.__dcfmkInitialized) return;
  window.__dcfmkInitialized = true;
  BoardNavigationController.mount();

  const earlyShield = initialThemeEnabled ? document.createElement("style") : null;
  let earlyShieldObserver = null;
  if (earlyShield) {
    earlyShield.id = "dcfmk-early-shield";
    earlyShield.textContent = "html.dcfmk-booting body{visibility:hidden!important}";
    const installEarlyShield = () => {
      if (!document.documentElement || earlyShield.isConnected) return false;
      document.documentElement.classList.add("dcfmk-booting");
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

  const AUTOMATED_REQUEST_PAUSED_KEY = "dcfmk:automated-request-paused";
  const AUTOMATED_REQUEST_LAST_AT_KEY = "dcfmk:automated-request-last-at";
  const AUTOMATED_REQUEST_NAVIGATION_AT_KEY = "dcfmk:navigation-last-at";
  const AUTOMATED_REQUEST_LOCK_NAME = "dcfmk:automated-request";
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

    async run(task, { force = false, shouldRun = null, navigationGapMs = this.minGapMs } = {}) {
      const signal = this.signal();
      const execute = async () => {
        if (signal.aborted) throw this.abortError();
        if (this.isPaused() && !force) throw new EmptyAutomatedResponseError();
        if (typeof shouldRun === "function" && !await shouldRun()) return undefined;
        const lastAt = Number(GM_getValue(AUTOMATED_REQUEST_LAST_AT_KEY, 0)) || 0;
        const now = Date.now();
        const automatedGap = Math.max(0, this.minGapMs - (now - lastAt));
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
      ".dcfmk-comments",
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
      if (!initialThemeEnabled || window.__dcfmkAdBlockerMounted) return;
      window.__dcfmkAdBlockerMounted = true;
      this.removeFrom(document);
      if (typeof MutationObserver !== "function") return;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => this.removeFrom(node));
        }
      });
      observer.observe(document, { childList: true, subtree: true });
      window.__dcfmkAdBlockerObserver = observer;
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
      return popupClass === "dcfmk-relation-popup"
        ? "dcfmk-relation-popup-opening"
        : "";
    },

    armOpening(popupClass) {
      const className = this.openingClass(popupClass);
      if (!className) return;
      document.documentElement.classList.add(className);
      if (document.documentElement.__dcfmkPopupOpeningTimer) {
        window.clearTimeout(document.documentElement.__dcfmkPopupOpeningTimer);
      }
      document.documentElement.__dcfmkPopupOpeningTimer = window.setTimeout(() => {
        document.documentElement.classList.remove(className);
        document.documentElement.__dcfmkPopupOpeningTimer = 0;
      }, 10000);
    },

    clearOpening(popupClass) {
      const className = this.openingClass(popupClass);
      if (className) document.documentElement.classList.remove(className);
      if (document.documentElement.__dcfmkPopupOpeningTimer) {
        window.clearTimeout(document.documentElement.__dcfmkPopupOpeningTimer);
        document.documentElement.__dcfmkPopupOpeningTimer = 0;
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
      if (popup.__dcfmkAnchoredPopupOrigin) return;
      popup.__dcfmkAnchoredPopupOrigin = {
        parent: popup.parentNode,
        nextSibling: popup.nextSibling,
        style: popup.getAttribute("style"),
      };
    },

    clearAlignmentTracking(popup) {
      for (const timer of popup?.__dcfmkAnchoredPopupAlignmentTimers || []) {
        window.clearTimeout(timer);
      }
      if (popup) popup.__dcfmkAnchoredPopupAlignmentTimers = [];
      popup?.__dcfmkAnchoredPopupResizeObserver?.disconnect();
      if (popup) popup.__dcfmkAnchoredPopupResizeObserver = null;
    },

    restoreOrigin(popup) {
      const origin = popup?.__dcfmkAnchoredPopupOrigin;
      if (!origin?.parent?.isConnected || !popup.isConnected) return false;
      popup.__dcfmkAnchoredPopupCloseObserver?.disconnect();
      popup.__dcfmkAnchoredPopupCloseObserver = null;
      this.clearAlignmentTracking(popup);
      if (origin.nextSibling?.parentNode === origin.parent) {
        origin.parent.insertBefore(popup, origin.nextSibling);
      } else {
        origin.parent.appendChild(popup);
      }
      popup.classList.remove(
        "dcfmk-anchored-popup",
        "dcfmk-manager-report-popup",
        "dcfmk-relation-popup",
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
      popup.__dcfmkAnchoredPopupAlignmentTimers = [50, 150, 400, 1000, 2500]
        .map((delay) => window.setTimeout(align, delay));
      if (typeof ResizeObserver !== "function") return;
      const observer = new ResizeObserver(align);
      const popupHost = DcAdapter.leftContent();
      const popupAnchor = resolveAnchor();
      if (popupHost) observer.observe(popupHost);
      if (popupAnchor && popupAnchor !== popupHost) observer.observe(popupAnchor);
      popup.__dcfmkAnchoredPopupResizeObserver = observer;
    },

    watchClose(popup) {
      popup.__dcfmkAnchoredPopupCloseObserver?.disconnect();
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
      popup.__dcfmkAnchoredPopupCloseObserver = observer;
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
      popup.classList.add("dcfmk-anchored-popup");
      if (popupClass) popup.classList.add(popupClass);
      if (popup.parentElement !== popupHost) popupHost.appendChild(popup);

      const popupRect = popup.getBoundingClientRect();
      if (popupRect.width <= 0 || popupRect.height <= 0) return false;
      const hostRect = popupHost.getBoundingClientRect();
      const anchorRect = popupAnchor.getBoundingClientRect();
      const listRect = DcAdapter.listRoot()?.getBoundingClientRect();
      const top = Math.max(0, anchorRect.bottom - hostRect.top + popupHost.scrollTop + 5);
      const right = Math.max(0, hostRect.right - (listRect?.right || hostRect.right));
      popup.style.setProperty("--dcfmk-anchored-popup-top", `${Math.round(top)}px`);
      popup.style.setProperty("--dcfmk-anchored-popup-right", `${Math.round(right)}px`);
      popup.style.setProperty("position", "absolute", "important");
      popup.style.setProperty("top", "var(--dcfmk-anchored-popup-top)", "important");
      popup.style.setProperty("right", "var(--dcfmk-anchored-popup-right)", "important");
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
      trigger.__dcfmkAnchoredPopupObserver?.disconnect();
      if (trigger.__dcfmkAnchoredPopupTimer) {
        window.clearTimeout(trigger.__dcfmkAnchoredPopupTimer);
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
        if (trigger.__dcfmkAnchoredPopupTimer) {
          window.clearTimeout(trigger.__dcfmkAnchoredPopupTimer);
          trigger.__dcfmkAnchoredPopupTimer = 0;
        }
        if (trigger.__dcfmkAnchoredPopupObserver === observer) {
          trigger.__dcfmkAnchoredPopupObserver = null;
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style"],
      });
      trigger.__dcfmkAnchoredPopupObserver = observer;
      trigger.__dcfmkAnchoredPopupTimer = window.setTimeout(() => {
        finish();
        observer.disconnect();
        if (trigger.__dcfmkAnchoredPopupObserver === observer) {
          trigger.__dcfmkAnchoredPopupObserver = null;
        }
        trigger.__dcfmkAnchoredPopupTimer = 0;
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
      if (trigger.__dcfmkNativeReadyTimer) {
        window.clearTimeout(trigger.__dcfmkNativeReadyTimer);
        trigger.__dcfmkNativeReadyTimer = 0;
      }
      delete trigger.dataset.dcfmkNativeClickPending;
      trigger.removeAttribute("aria-busy");
    },

    queueNativeClick(trigger, functionName) {
      if (trigger.dataset.dcfmkNativeClickPending === "true") return;
      trigger.dataset.dcfmkNativeClickPending = "true";
      trigger.setAttribute("aria-busy", "true");
      const startedAt = Date.now();
      const check = () => {
        if (!trigger.isConnected || Date.now() - startedAt >= 10000) {
          this.clearPendingClick(trigger);
          return;
        }
        if (!this.pageFunctionReady(functionName)) {
          trigger.__dcfmkNativeReadyTimer = window.setTimeout(check, 25);
          return;
        }
        this.clearPendingClick(trigger);
        trigger.dataset.dcfmkNativeClickReplay = "true";
        try {
          trigger.click();
        } finally {
          delete trigger.dataset.dcfmkNativeClickReplay;
        }
      };
      check();
    },

    watchAfterNativeClick(trigger, popupSelector, anchor, popupClass) {
      if (trigger.__dcfmkAnchoredPopupPostClickTimer) {
        window.clearTimeout(trigger.__dcfmkAnchoredPopupPostClickTimer);
      }
      trigger.__dcfmkAnchoredPopupPostClickTimer = window.setTimeout(() => {
        trigger.__dcfmkAnchoredPopupPostClickTimer = 0;
        this.watch(trigger, popupSelector, anchor, popupClass);
      }, 0);
    },

    refreshInPlace({ popup, trigger, popupSelector, anchor, popupClass }) {
      if (!popup || !trigger) return;
      trigger.__dcfmkAnchoredPopupRefreshObserver?.disconnect();
      if (trigger.__dcfmkAnchoredPopupRefreshTimer) {
        window.clearTimeout(trigger.__dcfmkAnchoredPopupRefreshTimer);
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
        trigger.__dcfmkAnchoredPopupRefreshObserver?.disconnect();
        trigger.__dcfmkAnchoredPopupRefreshObserver = null;
        if (trigger.__dcfmkAnchoredPopupRefreshTimer) {
          window.clearTimeout(trigger.__dcfmkAnchoredPopupRefreshTimer);
          trigger.__dcfmkAnchoredPopupRefreshTimer = 0;
        }
        return true;
      };
      queueMicrotask(finish);
      if (typeof MutationObserver !== "function") return;
      const observer = new MutationObserver(finish);
      observer.observe(document.body, { childList: true, subtree: true });
      trigger.__dcfmkAnchoredPopupRefreshObserver = observer;
      trigger.__dcfmkAnchoredPopupRefreshTimer = window.setTimeout(() => {
        finish();
        observer.disconnect();
        if (trigger.__dcfmkAnchoredPopupRefreshObserver === observer) {
          trigger.__dcfmkAnchoredPopupRefreshObserver = null;
        }
        trigger.__dcfmkAnchoredPopupRefreshTimer = 0;
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
      if (!trigger || !popupSelector || trigger.dataset.dcfmkAnchoredPopupBound === popupSelector) return;
      trigger.dataset.dcfmkAnchoredPopupBound = popupSelector;
      trigger.addEventListener("click", (event) => {
        if (!document.documentElement.classList.contains("dcfmk-enabled")) return;
        const openPopup = document.querySelector(popupSelector);
        if (this.isVisiblyOpen(openPopup)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.closeFromTrigger(openPopup, closeSelector);
          return;
        }
        if (trigger.dataset.dcfmkNativeClickReplay === "true") {
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
      ".btn_mngadmin_report, .gall_issuebox .relate, .dcfmk-submanager-toggle, button.smallestgag[onclick*='mini_member_join']",
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
        if (memberJoinTrigger.dataset.dcfmkNativeClickReplay === "true") return;
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
        const reportTrigger = document.querySelector(".dcfmk-manager-line .btn_mngadmin_report")
          || document.querySelector(".btn_mngadmin_report");
        const currentPopup = managerPopupAction.closest("#pop_manage_report_list");
        if (reportTrigger) {
          AnchoredPopupController.refreshInPlace({
            popup: currentPopup,
            trigger: reportTrigger,
            popupSelector: "#pop_manage_report_list",
            anchor: () => document.querySelector(".dcfmk-manager-line") || reportTrigger,
            popupClass: "dcfmk-manager-report-popup",
          });
        }
        return;
      }
      const trigger = event.target.closest?.(".btn_mngadmin_report, .gall_issuebox .relate");
      if (!trigger) return;
      if (trigger.matches(".gall_issuebox .relate")
        && !AnchoredPopupController.isVisiblyOpen(document.querySelector("#relation_popup"))) {
        AnchoredPopupController.armOpening("dcfmk-relation-popup");
      }
      if (trigger.dataset.dcfmkAnchoredPopupBound) return;
      if (GM_getValue(THEME_ENABLED_KEY, true) === false) return;
      const isManager = trigger.matches(".btn_mngadmin_report");
      const config = isManager
        ? {
            popupSelector: "#pop_manage_report_list",
            popupClass: "dcfmk-manager-report-popup",
            nativeFunction: "get_manage_report",
            closeSelector: ".poply_whiteclose",
            anchor: () => document.querySelector(".dcfmk-manager-line")
              || trigger.closest(".info_cont, .minor_intro_box, .mini_intro_box, .person_intro_box")
              || trigger,
          }
        : {
            popupSelector: "#relation_popup",
            popupClass: "dcfmk-relation-popup",
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
      if (trigger.dataset.dcfmkNativeClickReplay === "true") {
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
      const reportTrigger = document.querySelector(".dcfmk-manager-line .btn_mngadmin_report")
        || document.querySelector(".btn_mngadmin_report");
      const currentPopup = event.target.closest("#pop_manage_report_list");
      if (!reportTrigger || !currentPopup) return;
      AnchoredPopupController.refreshInPlace({
        popup: currentPopup,
        trigger: reportTrigger,
        popupSelector: "#pop_manage_report_list",
        anchor: () => document.querySelector(".dcfmk-manager-line") || reportTrigger,
        popupClass: "dcfmk-manager-report-popup",
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
      root.classList.add("dcfmk-ready", `dcfmk-page-${context.pageType}`, `dcfmk-gallery-${context.galleryType}`);
      root.classList.toggle("dcfmk-realtime-best", context.isRealtimeBest);
      root.dataset.dcfmkVersion = SCRIPT_VERSION;
      this.injectBaseStyle();
      root.classList.toggle("dcfmk-enabled", this.isEnabled());
      this.mountScreenToggle();
    },

    setEnabled(enabled) {
      GM_setValue(THEME_ENABLED_KEY, Boolean(enabled));
      document.documentElement.classList.toggle("dcfmk-enabled", Boolean(enabled));
    },

    mountScreenToggle(target = null) {
      let button = document.getElementById("dcfmk-theme-toggle");
      if (!button) {
        button = document.createElement("button");
        button.id = "dcfmk-theme-toggle";
        button.type = "button";
        button.setAttribute("role", "switch");
        button.innerHTML = `
          <span class="dcfmk-theme-toggle-label">UI변경</span>
          <span class="dcfmk-theme-toggle-track" aria-hidden="true">
            <span class="dcfmk-theme-toggle-thumb"></span>
          </span>
        `;
        button.addEventListener("click", () => {
          if (button.dataset.dcfmkThemeTransitioning === "true") return;
          button.dataset.dcfmkThemeTransitioning = "true";
          const thumb = button.querySelector(".dcfmk-theme-toggle-thumb");
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

    syncScreenToggle(button) {
      const enabled = this.isEnabled();
      button.setAttribute("aria-checked", String(enabled));
      button.setAttribute("aria-label", `UI 변경 ${enabled ? "끄기" : "켜기"}`);
      button.title = enabled ? "디시인사이드 원본 UI로 전환" : "새 UI로 전환";
    },

    placeScreenToggle(button, target = null) {
      if (target) {
        document.getElementById("dcfmk-native-theme-toggle-mount")?.remove();
        document.getElementById("dcfmk-native-theme-toggle-list")?.remove();
        target.appendChild(button);
        return;
      }

      const nativeDarkMode = document.querySelector("#top > .dcheader .area_links > .darkmodebox, .dcheader .area_links > .darkmodebox");
      if (nativeDarkMode) {
        document.getElementById("dcfmk-native-theme-toggle-mount")?.remove();
        let list = document.getElementById("dcfmk-native-theme-toggle-list");
        if (!list) {
          list = document.createElement("ul");
          list.id = "dcfmk-native-theme-toggle-list";
          list.className = "fl dcfmk-theme-toggle-list";
          const item = document.createElement("li");
          item.id = "dcfmk-native-theme-toggle-item";
          list.appendChild(item);
          nativeDarkMode.insertAdjacentElement("afterend", list);
        }
        list.querySelector("#dcfmk-native-theme-toggle-item")?.appendChild(button);
        return;
      }
      document.body.appendChild(button);
    },

    injectBaseStyle() {
      if (document.getElementById("dcfmk-base-style")) return;

      const style = document.createElement("style");
      style.id = "dcfmk-base-style";
      style.textContent = `
        html.dcfmk-enabled {
          --dcfmk-page-width: 1050px;
          --dcfmk-content-width: 840px;
          --dcfmk-sidebar-width: 190px;
          --dcfmk-column-gap: 20px;
          --dcfmk-color-text: #333;
          --dcfmk-color-muted: #777;
          --dcfmk-color-link: #3b4890;
          --dcfmk-color-accent: #3b4890;
          --dcfmk-color-nav: #29367c;
          --dcfmk-color-nav-light: #3b4890;
          --dcfmk-color-surface: #fff;
          --dcfmk-color-subtle: #f9f9f9;
          --dcfmk-color-border: #ddd;
          --dcfmk-control-border: #b9c1dc;
          --dcfmk-control-border-hover: #8996c8;
          --dcfmk-control-border-focus: #3b4890;
          --dcfmk-control-addon-border: #d7dbea;
          --dcfmk-control-addon-surface: #f4f5fa;
          --dcfmk-control-radius: 3px;
          --dcfmk-control-shadow: 0 1px 1px rgb(40 50 100 / 5%);
          --dcfmk-font: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", Arial, Dotum, 돋움, sans-serif;
          color: var(--dcfmk-color-text);
          background: var(--dcfmk-color-surface);
        }
        html.dcfmk-enabled body,
        html.dcfmk-enabled button,
        html.dcfmk-enabled input,
        html.dcfmk-enabled select,
        html.dcfmk-enabled textarea {
          font-family: var(--dcfmk-font);
        }
        html.dcfmk-enabled body {
          min-width: var(--dcfmk-page-width);
          background: var(--dcfmk-color-surface);
          color: var(--dcfmk-color-text);
        }
        html.dcfmk-enabled .ad_left_wing_list_top,
        html.dcfmk-enabled .ad_left_wing_right_top,
        html.dcfmk-enabled .ad_left_wing_list_top + div[style*="position:absolute"][style*="margin-left"],
        html.dcfmk-enabled #ad-layer,
        html.dcfmk-enabled #ad-pop-layer,
        html.dcfmk-enabled #ad-layer-closer,
        html.dcfmk-enabled #ad-pop-layer-closer,
        html.dcfmk-enabled .banner_box:has(> script[src*="addc.dcinside.com/NetInsight/"]),
        html.dcfmk-enabled .banner_box:has(> a[href*="addc.dcinside.com"][href*="/click/dcinside/pc/list@top_"]),
        html.dcfmk-enabled .con_banner.writing_banbox,
        html.dcfmk-enabled .stickyunit,
        html.dcfmk-enabled #gfp_sf_align > #ad-element,
        html.dcfmk-enabled #gfp_sf_align > .native_image_wrap,
        html.dcfmk-enabled .cm_ad[data-ad-node] > .link_ad,
        html.dcfmk-enabled .cm_ad[data-ad-node] > .icon_ad,
        html.dcfmk-enabled .kakao_ad_area,
        html.dcfmk-enabled .google-auto-placed,
        html.dcfmk-enabled [id^="google_ads_"],
        html.dcfmk-enabled [id^="div-gpt-ad"],
        html.dcfmk-enabled [id^="criteo-"],
        html.dcfmk-enabled ins.adsbygoogle,
        html.dcfmk-enabled iframe[id^="ad_frame"],
        html.dcfmk-enabled iframe[src*="ad.xc.netinsight.co.kr"],
        html.dcfmk-enabled iframe[src*="ad.adnmore.co.kr"],
        html.dcfmk-enabled iframe[src*="doubleclick.net"],
        html.dcfmk-enabled iframe[src*="googlesyndication.com"] {
          display: none !important;
        }
        html.dcfmk-enabled table.gall_list tr.dcfmk-row-ad,
        html.dcfmk-enabled table.gall_list tr[data-type="icon_ad"] {
          display: none !important;
        }
        html.dcfmk-enabled footer.dcfoot .dc_all {
          display: none !important;
        }
        html.dcfmk-enabled .wrap_inner,
        html.dcfmk-enabled #container {
          width: var(--dcfmk-page-width);
        }
        html.dcfmk-enabled .page_head {
          border-bottom-color: var(--dcfmk-color-border);
        }
        html.dcfmk-enabled .page_head h2 a {
          color: var(--dcfmk-color-link);
        }
        html.dcfmk-enabled :focus-visible {
          outline: 2px solid var(--dcfmk-color-accent);
          outline-offset: 2px;
        }
        html.dcfmk-enabled .dcfmk-control-frame {
          box-sizing: border-box;
          border: 1px solid var(--dcfmk-control-border) !important;
          border-radius: var(--dcfmk-control-radius) !important;
          background: var(--dcfmk-color-surface) !important;
          box-shadow: var(--dcfmk-control-shadow) !important;
          transition: border-color 100ms ease, box-shadow 100ms ease;
        }
        html.dcfmk-enabled .dcfmk-control-frame:hover {
          border-color: var(--dcfmk-control-border-hover) !important;
        }
        html.dcfmk-enabled .dcfmk-control-frame:focus-visible,
        html.dcfmk-enabled .dcfmk-control-frame:focus-within {
          border-color: var(--dcfmk-control-border-focus) !important;
          box-shadow: 0 0 0 1px var(--dcfmk-control-border-focus) !important;
          outline: 0;
        }
        html.dcfmk-enabled .dcfmk-control-frame .dcfmk-control-addon {
          border-left: 1px solid var(--dcfmk-control-addon-border) !important;
          background: var(--dcfmk-control-addon-surface) !important;
        }
        html.dcfmk-enabled ::selection {
          background: #e4e7f3;
          color: #111;
        }
        #dcfmk-theme-toggle {
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
          color: #555;
          font: 400 11px/22px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", Arial, Dotum, sans-serif;
          white-space: nowrap;
          cursor: pointer;
        }
        #dcfmk-theme-toggle .dcfmk-theme-toggle-label {
          line-height: 22px;
        }
        #dcfmk-theme-toggle .dcfmk-theme-toggle-track {
          position: relative;
          box-sizing: border-box;
          display: inline-block;
          width: 32px;
          height: 16px;
          flex: 0 0 32px;
          border: 1px solid #aaa;
          border-radius: 999px;
          background: #bbb;
          transition: border-color 160ms ease, background-color 160ms ease;
        }
        #dcfmk-theme-toggle .dcfmk-theme-toggle-thumb {
          position: absolute;
          top: 1px;
          left: 1px;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 2px rgb(0 0 0 / 28%);
          transition: transform 160ms ease;
        }
        #dcfmk-theme-toggle[aria-checked="true"] .dcfmk-theme-toggle-track {
          border-color: #3b4890;
          background: #3b4890;
        }
        #dcfmk-theme-toggle[aria-checked="true"] .dcfmk-theme-toggle-thumb {
          transform: translateX(16px);
        }
        #dcfmk-theme-toggle:hover .dcfmk-theme-toggle-label,
        #dcfmk-theme-toggle:focus-visible .dcfmk-theme-toggle-label {
          color: #3b4890;
        }
        #dcfmk-theme-toggle:focus-visible {
          border-radius: 3px;
          outline: 2px solid #3b4890;
          outline-offset: 2px;
        }
        #dcfmk-native-theme-toggle-list {
          margin: 0;
          overflow: visible;
        }
        .area_links #dcfmk-native-theme-toggle-list > li:first-child::before,
        .area_links #dcfmk-native-theme-toggle-list > li:last-child::before {
          display: inline;
          content: "|";
          color: #ccc;
          font-size: 10px;
          line-height: 10px;
          padding: 0 5px 0 4px;
          vertical-align: 1px;
        }
        .dcheader .area_links #dcfmk-theme-toggle {
          height: 18px;
          gap: 5px;
          font-size: 11px;
          line-height: 18px;
          vertical-align: top;
        }
        .dcheader .area_links #dcfmk-theme-toggle .dcfmk-theme-toggle-label {
          line-height: 18px;
        }
        body > #dcfmk-theme-toggle {
          position: fixed;
          z-index: 2147483646;
          top: 8px;
          right: 8px;
          padding: 2px 6px;
          border: 1px solid #ddd;
          border-radius: 3px;
          background: #fff;
          box-shadow: 0 2px 6px rgb(0 0 0 / 18%);
        }
      `;
      document.documentElement.appendChild(style);
    },
  });

  const CustomSettingsController = {
    writerObserver: null,

    init() {
      this.setGalleryCoverHidden(GM_getValue(GALLERY_COVER_HIDDEN_KEY, false) === true, false);
      this.setUserIdentifierVisible(GM_getValue(USER_IDENTIFIER_VISIBLE_KEY, false) === true, false);
    },

    mount(settingList) {
      const list = settingList?.querySelector(".inner > ul, ul");
      if (!list || list.querySelector(".dcfmk-custom-setting")) return;

      const controls = [
        {
          id: "dcfmk-hide-gallery-cover",
          label: "대문 이미지 숨김",
          checked: GM_getValue(GALLERY_COVER_HIDDEN_KEY, false) === true,
          change: (checked) => this.setGalleryCoverHidden(checked),
        },
        {
          id: "dcfmk-show-user-identifier",
          label: "이용자 식별 코드 표시",
          checked: GM_getValue(USER_IDENTIFIER_VISIBLE_KEY, false) === true,
          change: (checked) => this.setUserIdentifierVisible(checked),
        },
        {
          id: "dcfmk-enable-concept-alarm",
          label: "개념글 알림",
          checked: ConceptAlarmController.isEnabled(),
          change: (checked) => ConceptAlarmController.setEnabled(checked),
        },
      ];

      const fragment = document.createDocumentFragment();
      for (const control of controls) {
        const item = document.createElement("li");
        item.className = "dcfmk-custom-setting";
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
    },

    setGalleryCoverHidden(hidden, persist = true) {
      const value = Boolean(hidden);
      if (persist) GM_setValue(GALLERY_COVER_HIDDEN_KEY, value);
      document.documentElement.classList.toggle("dcfmk-gallery-cover-hidden", value);
      const input = document.getElementById("dcfmk-hide-gallery-cover");
      if (input) input.checked = value;
    },

    setUserIdentifierVisible(visible, persist = true) {
      const value = Boolean(visible);
      if (persist) GM_setValue(USER_IDENTIFIER_VISIBLE_KEY, value);
      document.documentElement.classList.toggle("dcfmk-user-identifier-visible", value);
      const input = document.getElementById("dcfmk-show-user-identifier");
      if (input) input.checked = value;
      if (value) {
        this.decorateWriters(document);
        this.watchWriters();
      } else {
        this.writerObserver?.disconnect();
        this.writerObserver = null;
        document.querySelectorAll(".dcfmk-user-identifier").forEach((node) => node.remove());
      }
    },

    decorateWriters(root) {
      const writers = [];
      if (root instanceof Element && root.matches(".ub-writer")) writers.push(root);
      root.querySelectorAll?.(".ub-writer").forEach((writer) => writers.push(writer));
      for (const writer of writers) this.decorateWriter(writer);
    },

    decorateWriter(writer) {
      const existing = writer.querySelector(":scope .dcfmk-user-identifier");
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
        return;
      }

      const identifier = document.createElement("span");
      identifier.className = "dcfmk-user-identifier";
      identifier.textContent = `(${uid})`;
      identifier.title = `식별 코드: ${uid}`;
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
      if (document.getElementById("dcfmk-gallery-strip")) return;

      const strip = document.createElement("section");
      strip.id = "dcfmk-gallery-strip";
      strip.setAttribute("aria-label", "내 갤러리 바로가기");
      strip.innerHTML = `
        <div class="dcfmk-gallery-strip-inner">
          <div class="dcfmk-gallery-strip-viewport" data-role="galleryStripViewport">
            <div class="dcfmk-gallery-strip-track">
              <div class="dcfmk-gallery-strip-group dcfmk-favorites" data-role="favoriteGalleries"></div>
              <div class="dcfmk-gallery-strip-group dcfmk-recents" data-role="recentGalleries"></div>
            </div>
          </div>
          <button type="button" class="dcfmk-gallery-strip-expand" data-role="galleryStripExpand" aria-expanded="false" aria-label="최근 방문 갤러리 펼치기">
            <span class="dcfmk-gallery-strip-expand-icon" aria-hidden="true"></span>
          </button>
        </div>
        <div class="dcfmk-gallery-strip-expanded" data-role="galleryStripExpanded" hidden>
          <div class="dcfmk-gallery-strip-expanded-list" data-role="galleryStripExpandedList"></div>
          <div class="dcfmk-gallery-strip-footer">
            <span class="dcfmk-gallery-strip-footer-label">최근방문:</span>
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
      strip.__dcfmkGalleryData = { favoriteLinks, recentLinks: uniqueRecentLinks };
      document.dispatchEvent(new CustomEvent("dcfmk:favorites-updated", {
        detail: { favoriteLinks },
      }));
      const track = strip.querySelector(".dcfmk-gallery-strip-track");
      let favoriteGroup = strip.querySelector('[data-role="favoriteGalleries"]');
      if (favoriteLinks.length === 0) {
        favoriteGroup?.remove();
      } else {
        if (!favoriteGroup && track) {
          favoriteGroup = document.createElement("div");
          favoriteGroup.className = "dcfmk-gallery-strip-group dcfmk-favorites";
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
        const shortcut = url.pathname.match(/^\/(mini|mgallery|person)\/([^/]+)\/?$/);
        if (shortcut) {
          url.pathname = `/${shortcut[1]}/board/lists/`;
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
        empty.className = "dcfmk-gallery-strip-empty";
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
        wrapper.className = "dcfmk-gallery-strip-item";
        wrapper.appendChild(link);
        if (item.deleteId) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "dcfmk-gallery-strip-delete";
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
        wrapper.className = `dcfmk-gallery-strip-expanded-item ${favorite ? "dcfmk-favorite" : "dcfmk-recent"}`;
        const link = document.createElement("a");
        link.href = item.href;
        link.textContent = item.name;
        wrapper.appendChild(link);
        if (!favorite && item.deleteId) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "dcfmk-gallery-strip-delete";
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
      list.parentElement?.classList.toggle("dcfmk-no-expanded-items", list.childElementCount === 0);
    },

    renderExpandedRemainder(strip) {
      const data = strip.__dcfmkGalleryData || { favoriteLinks: [], recentLinks: [] };
      const viewport = strip.querySelector('[data-role="galleryStripViewport"]');
      const viewportRect = viewport?.getBoundingClientRect();
      const visibleKeys = new Set();
      if (viewportRect) {
        for (const link of viewport.querySelectorAll(".dcfmk-gallery-strip-group a")) {
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
        strip.classList.toggle("dcfmk-expanded", open);
        expanded.hidden = !open;
        expandButton.setAttribute("aria-expanded", String(open));
        expandButton.setAttribute("aria-label", `최근 방문 갤러리 ${open ? "닫기" : "펼치기"}`);
        if (open) this.renderExpandedRemainder(strip);
      };
      expandButton.addEventListener("click", () => setExpanded(!strip.classList.contains("dcfmk-expanded")));
      deleteModeButton?.addEventListener("click", () => {
        const active = !strip.classList.contains("dcfmk-delete-mode");
        strip.classList.toggle("dcfmk-delete-mode", active);
        expanded.classList.toggle("dcfmk-delete-mode", active);
        deleteModeButton.setAttribute("aria-pressed", String(active));
      });
      strip.addEventListener("click", (event) => {
        const remove = event.target.closest(".dcfmk-gallery-strip-delete");
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
        if (event.key === "Escape" && strip.classList.contains("dcfmk-expanded")) setExpanded(false);
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
        viewport.classList.remove("dcfmk-dragging");
        this.updateControls(strip);
        window.setTimeout(() => {
          suppressClick = false;
        }, 0);
      };

      viewport.addEventListener("pointerdown", (event) => {
        if (strip.classList.contains("dcfmk-expanded") || !event.isPrimary || event.button !== 0) return;
        activePointerId = event.pointerId;
        startX = event.clientX;
        startScrollLeft = viewport.scrollLeft;
        dragged = false;
        suppressClick = false;
      });
      viewport.addEventListener("pointermove", (event) => {
        if (event.pointerId !== activePointerId) return;
        if (strip.classList.contains("dcfmk-expanded")) {
          finishDrag(event);
          return;
        }
        const distance = event.clientX - startX;
        if (!dragged && Math.abs(distance) > 7) {
          dragged = true;
          suppressClick = true;
          viewport.classList.add("dcfmk-dragging");
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
        if (strip.classList.contains("dcfmk-expanded")) this.renderExpandedRemainder(strip);
      }, { passive: true });
    },

    updateControls(strip) {
      const viewport = strip.querySelector('[data-role="galleryStripViewport"]');
      if (!viewport) return;
      viewport.classList.toggle("dcfmk-can-scroll", viewport.scrollWidth > viewport.clientWidth + 1);
    },

    injectStyle() {
      if (document.getElementById("dcfmk-gallery-strip-style")) return;
      const style = document.createElement("style");
      style.id = "dcfmk-gallery-strip-style";
      style.textContent = `
        #dcfmk-gallery-strip {
          display: none;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip {
          display: block;
          border-bottom: 0;
          background: transparent;
          color: #444;
          font: 12px/1.4 var(--dcfmk-font);
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-inner {
          display: flex;
          box-sizing: border-box;
          width: var(--dcfmk-page-width);
          height: 36px;
          margin: 0 auto;
          padding: 5px;
          align-items: center;
          border-bottom: 1px solid #d8d8d8;
          background: #fafafa;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-viewport {
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
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expand {
          display: inline-flex;
          flex: 0 0 26px;
          box-sizing: border-box;
          width: 26px;
          height: 26px;
          align-items: center;
          justify-content: center;
          margin-left: 5px;
          padding: 0;
          border: 1px solid #c9c9c9;
          border-radius: 2px;
          background: linear-gradient(#fff, #f1f1f1);
          color: #555;
          font: 700 11px/24px var(--dcfmk-font);
          cursor: pointer;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expand:hover {
          border-color: #aab0ca;
          color: var(--dcfmk-color-nav);
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expand-icon {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-right: 1px solid currentColor;
          border-bottom: 1px solid currentColor;
          transform: rotate(45deg) translateY(-2px);
        }
        html.dcfmk-enabled #dcfmk-gallery-strip.dcfmk-expanded .dcfmk-gallery-strip-expand-icon {
          transform: rotate(225deg) translateY(-2px);
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-viewport::-webkit-scrollbar {
          display: none;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-viewport.dcfmk-dragging {
          cursor: grabbing;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip.dcfmk-expanded .dcfmk-gallery-strip-viewport,
        html.dcfmk-enabled #dcfmk-gallery-strip.dcfmk-expanded .dcfmk-gallery-strip-viewport.dcfmk-dragging {
          cursor: default;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-track {
          display: flex;
          width: max-content;
          min-width: 100%;
          height: 26px;
          gap: 5px;
          align-items: stretch;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-group {
          display: flex;
          flex: 0 0 auto;
          gap: 5px;
          align-items: center;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-favorites {
          background: transparent;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-recents {
          border-left: 0;
          background: transparent;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-group a {
          flex: 0 0 auto;
          box-sizing: border-box;
          height: 26px;
          padding: 7px;
          border-radius: 5px;
          background: #eee;
          color: #333;
          font-size: 12px;
          font-weight: 700;
          line-height: 12px;
          text-decoration: none;
          white-space: nowrap;
          -webkit-user-drag: none;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-item {
          display: inline-flex;
          flex: 0 0 auto;
          height: 26px;
          align-items: stretch;
          overflow: hidden;
          border-radius: 5px;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip.dcfmk-delete-mode .dcfmk-gallery-strip-item a {
          border-radius: 5px 0 0 5px;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-favorites a {
          background: var(--dcfmk-color-nav-light);
          color: #fff;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-group a:hover {
          background: #d4d4d4;
          color: #000;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-favorites a:hover {
          background: var(--dcfmk-color-nav);
          color: #ffea00;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-empty {
          display: block;
          box-sizing: border-box;
          height: 26px;
          padding: 7px;
          border-radius: 5px;
          background: #eee;
          color: #999;
          font-size: 12px;
          line-height: 12px;
          white-space: nowrap;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded {
          box-sizing: border-box;
          width: var(--dcfmk-page-width);
          margin: 0 auto;
          padding: 5px 5px 0;
          border-bottom: 1px solid #d8d8d8;
          background: #fafafa;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded[hidden] {
          display: none !important;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded-list {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded-list:empty {
          display: none;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded.dcfmk-no-expanded-items {
          padding-top: 0;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded-item {
          display: inline-flex;
          box-sizing: border-box;
          height: 26px;
          align-items: stretch;
          overflow: visible;
          border-radius: 5px;
          background: #eee;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded-item.dcfmk-favorite {
          background: var(--dcfmk-color-nav-light);
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded-item a {
          display: inline-flex;
          align-items: center;
          padding: 0 7px;
          color: #333;
          font-size: 12px;
          font-weight: 700;
          line-height: 26px;
          text-decoration: none;
          white-space: nowrap;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded-item.dcfmk-favorite a {
          color: #fff;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded-item:hover {
          background: #d4d4d4;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded-item.dcfmk-favorite:hover {
          background: var(--dcfmk-color-nav);
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-delete {
          display: none;
          width: 22px;
          padding: 0;
          border: 0;
          border-left: 1px solid #d0d0d0;
          background: #e4e4e4;
          color: #777;
          font: 700 16px/24px Arial, sans-serif;
          cursor: pointer;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip.dcfmk-delete-mode .dcfmk-gallery-strip-delete,
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-delete-mode .dcfmk-gallery-strip-delete {
          display: block;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-delete:hover {
          background: #d9534f;
          color: #fff;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded-empty {
          padding: 5px 7px;
          color: #999;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-footer {
          display: flex;
          height: 29px;
          align-items: center;
          gap: 10px;
          margin-top: 5px;
          border-top: 1px solid #ddd;
          color: #777;
          font-size: 11px;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-expanded-list:empty + .dcfmk-gallery-strip-footer {
          margin-top: 0;
          border-top: 0;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-footer button {
          padding: 0;
          border: 0;
          background: transparent;
          color: #666;
          font: 11px/28px var(--dcfmk-font);
          cursor: pointer;
        }
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-footer button:hover,
        html.dcfmk-enabled #dcfmk-gallery-strip .dcfmk-gallery-strip-footer button[aria-pressed="true"] {
          color: var(--dcfmk-color-nav);
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
      root.dataset.dcfmkConceptAlarmEnabled = String(this.isEnabled());
      root.dataset.dcfmkConceptAlarmScheduled = String(conceptAlarmTimer !== 0);
      root.dataset.dcfmkConceptAlarmRunning = String(conceptAlarmRunning);
    },

    clearSchedule() {
      window.clearTimeout(conceptAlarmTimer);
      conceptAlarmTimer = 0;
      this.syncDocumentState();
    },

    setEnabled(enabled) {
      const value = Boolean(enabled);
      GM_setValue(CONCEPT_ALARM_ENABLED_KEY, value);
      const input = document.getElementById("dcfmk-enable-concept-alarm");
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
      document.dispatchEvent(new CustomEvent("dcfmk:concept-feed", {
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
      document.dispatchEvent(new CustomEvent("dcfmk:concept-feed", {
        detail: {
          galleryKey: context.galleryKey,
          posts: cached.posts,
          status: cached.posts.length ? "ready" : "empty",
        },
      }));
      return cached;
    },

    publishFeedError(context) {
      document.dispatchEvent(new CustomEvent("dcfmk:concept-feed", {
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
          border: 1px solid #29367c;
          padding: 10px 12px;
          background: #fff;
          color: #222;
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
          color: #29367c;
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
        document.getElementById("dcfmk-featured-posts")?.remove();
        return null;
      }
      let section = document.getElementById("dcfmk-featured-posts");
      if (section) return section;

      section = document.createElement("section");
      section.id = "dcfmk-featured-posts";
      section.setAttribute("aria-label", "실시간 베스트와 최신 개념글");
      section.innerHTML = `
        <div class="dcfmk-featured-column dcfmk-featured-realtime">
          <h3><a data-role="realtimeHeading">실시간 베스트</a></h3>
          <ul data-role="realtimeList"></ul>
        </div>
        <div class="dcfmk-featured-column dcfmk-featured-concept">
          <h3><a data-role="conceptHeading"></a></h3>
          <ul data-role="conceptList"><li class="dcfmk-featured-status">개념글을 불러오는 중입니다.</li></ul>
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
        document.removeEventListener("dcfmk:concept-feed", onConceptFeed);
        return true;
      };
      const onConceptFeed = (event) => {
        if (event.detail?.galleryKey !== context.galleryKey) return;
        renderConceptOnce(event.detail.posts || [], event.detail.status);
      };
      document.addEventListener("dcfmk:concept-feed", onConceptFeed);
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
        link.className = "dcfmk-featured-title";
        link.href = post.href;
        link.textContent = post.title;
        link.title = post.title;
        item.appendChild(link);
        list.appendChild(item);
      }
      if (!list.childElementCount) {
        const empty = document.createElement("li");
        empty.className = "dcfmk-featured-status";
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
        title.className = "dcfmk-featured-title";
        title.href = post.url;
        title.textContent = post.title;
        title.title = post.title;

        const comments = document.createElement("a");
        comments.className = "dcfmk-featured-comments";
        const commentUrl = new URL(post.url, location.href);
        commentUrl.hash = "focus_cmt";
        comments.href = commentUrl.href;
        comments.textContent = String(post.commentCount || "0");
        comments.setAttribute("aria-label", `댓글 ${post.commentCount || "0"}개`);

        const recommends = document.createElement("span");
        recommends.className = "dcfmk-featured-recommends";
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
      status.className = "dcfmk-featured-status";
      status.textContent = message;
      list.replaceChildren(status);
    },

    injectStyle() {
      if (document.getElementById("dcfmk-featured-posts-style")) return;
      const style = document.createElement("style");
      style.id = "dcfmk-featured-posts-style";
      style.textContent = `
        #dcfmk-featured-posts { display: none; }
        html.dcfmk-enabled #dcfmk-featured-posts {
          display: grid;
          box-sizing: border-box;
          width: 100%;
          grid-template-columns: 49% 49%;
          column-gap: 2%;
          margin: 0 0 12px;
          padding: 0 13px 10px;
          border: 0;
          background: #fff;
          font-family: Arial, "Malgun Gothic", sans-serif;
        }
        html.dcfmk-enabled #container:has(#dcfmk-featured-posts) {
          margin-top: 5px !important;
        }
        html.dcfmk-enabled.dcfmk-gallery-major #gall_top_recom {
          display: none !important;
        }
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-column {
          min-width: 0;
        }
        html.dcfmk-enabled #dcfmk-featured-posts h3 {
          height: 27px;
          margin: 0;
          border: 0;
          font-size: 16px;
          line-height: 26px;
        }
        html.dcfmk-enabled #dcfmk-featured-posts h3 a {
          color: #29367c;
          font-weight: 700;
          text-decoration: none;
        }
        html.dcfmk-enabled #dcfmk-featured-posts h3 a:hover,
        html.dcfmk-enabled #dcfmk-featured-posts h3 a:focus-visible {
          text-decoration: underline;
        }
        html.dcfmk-enabled #dcfmk-featured-posts ul {
          margin: 5px 0 0;
          padding: 0;
          list-style: none;
        }
        html.dcfmk-enabled #dcfmk-featured-posts li {
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
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-title {
          display: block;
          min-width: 0;
          flex: 1 1 auto;
          overflow: hidden;
          color: #666;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-decoration: none;
        }
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-title:visited {
          color: #a6a6a6;
        }
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-title::before {
          content: "·";
          margin-right: 5px;
          color: #8c8c8c;
        }
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-title:hover,
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-title:focus-visible {
          color: #29367c;
          text-decoration: underline;
        }
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-comments,
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-recommends {
          flex: 0 0 auto;
          font-size: 11px;
          text-decoration: none;
        }
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-comments {
          color: #377ee9;
          font-weight: 700;
        }
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-comments::before {
          content: "[";
        }
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-comments::after {
          content: "]";
        }
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-recommends {
          min-width: 25px;
          color: #777;
          text-align: right;
        }
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-recommends::before {
          content: "▲";
          margin-right: 2px;
          color: #999;
          font-size: 8px;
        }
        html.dcfmk-enabled #dcfmk-featured-posts .dcfmk-featured-status {
          color: #999;
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

      const existing = document.getElementById("dcfmk-shell");
      if (existing) return this.elements(existing, document.getElementById("dcfmk-sidebar"));

      const originalLoginLink = DcAdapter.loginLink();
      const shell = document.createElement("header");
      shell.id = "dcfmk-shell";
      shell.innerHTML = `
        <div class="dcfmk-utility">
          <div class="dcfmk-inner">
            <p>CONNECTING HEARTS! 디시인사이드입니다.</p>
            <nav aria-label="사용자 메뉴">
              <a data-role="myInfo">내 정보</a>
              <a data-role="myPosts">내 글</a>
              <a data-role="myComments">내 댓글</a>
              <div class="dcfmk-native-alarm-mount" data-role="nativeAlarmMount">
                <button type="button" data-role="nativeAlarm">내 알림<em aria-hidden="true"></em></button>
              </div>
              <a data-role="login">로그인</a>
              <div class="dcfmk-theme-toggle-mount" data-role="themeToggleMount"></div>
            </nav>
          </div>
        </div>
        <div class="dcfmk-brand-row dcfmk-inner">
          <div class="dcfmk-brand-slot" data-role="brandSlot">
            <a class="dcfmk-brand dcfmk-brand-fallback" data-role="listLink">
              <strong>디시인사이드</strong><span>dcinside.com</span>
            </a>
          </div>
          <div class="dcfmk-search-slot" data-role="searchSlot"></div>
        </div>
        <div class="dcfmk-nav-bar">
          <nav class="dcfmk-inner" aria-label="갤러리 메뉴">
            <div class="dcfmk-gallery-menu">
              <a class="dcfmk-active" data-role="galleryHome">갤러리</a>
              <div class="dcfmk-category-bar" aria-label="갤러리 분류">
                <a data-role="categoryGame">게임</a>
                <a data-role="categoryEnter">연예/방송</a>
                <a data-role="categorySports">스포츠</a>
                <a data-role="categoryEdu">교육/금융/IT</a>
                <a data-role="categoryTravel">여행/음식/생물</a>
                <a data-role="categoryHobby">취미/생활</a>
              </div>
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
      shell.querySelectorAll(".dcfmk-nav-bar > nav > a, .dcfmk-gallery-menu > a")
        .forEach((link) => link.classList.remove("dcfmk-active"));
      const activeNavRole = {
        major: "galleryHome",
        minor: "minorHome",
        mini: "miniHome",
        person: "personHome",
      }[context.galleryType] || "galleryHome";
      shell.querySelector(`[data-role="${activeNavRole}"]`)?.classList.add("dcfmk-active");
      shell.querySelector('[data-role="categoryGame"]').href = "https://game.dcinside.com/";
      shell.querySelector('[data-role="categoryEnter"]').href = "https://enter.dcinside.com/";
      shell.querySelector('[data-role="categorySports"]').href = "https://sports.dcinside.com/";
      shell.querySelector('[data-role="categoryEdu"]').href = "https://edu.dcinside.com/";
      shell.querySelector('[data-role="categoryTravel"]').href = "https://travel.dcinside.com/";
      shell.querySelector('[data-role="categoryHobby"]').href = "https://hobby.dcinside.com/";

      const originalLogo = DcAdapter.logo();
      if (originalLogo) {
        originalLogo.classList.add("dcfmk-brand", "dcfmk-native-logo");
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
        rightContent.className = "right_content dcfmk-created-right-content";
        container.insertBefore(rightContent, leftContent.nextSibling);
      }

      const sidebar = document.createElement("aside");
      sidebar.id = "dcfmk-sidebar";
      sidebar.innerHTML = `
        <section class="dcfmk-side-card dcfmk-hotkeys">
          <div class="dcfmk-side-title">
            <strong>단축키</strong>
          </div>
          <ul data-role="shortcutList">
            <li><kbd>alt+c</kbd><a href="#" data-role="sideComment">댓글 쓰기</a></li>
            <li><kbd>alt+w</kbd><a data-role="sideWrite">글 쓰기</a></li>
            <li><kbd>alt+q</kbd><button type="button" data-role="sideRegister">댓글 등록</button></li>
            <li><kbd>e</kbd><a href="#dcfmk-shell">상단으로</a></li>
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
          if (node.closest("#dcfmk-shell, #dcfmk-sidebar")) continue;
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
      if (!settingButton || !bundle || sidebar.querySelector(".dcfmk-gallery-settings")) return null;

      const card = document.createElement("section");
      card.className = "dcfmk-side-card dcfmk-gallery-settings";
      card.innerHTML = `
        <div class="dcfmk-side-title">
          <strong>설정</strong>
          <button type="button" class="dcfmk-gallery-settings-toggle" aria-controls="dcfmk-gallery-settings-body">숨기기</button>
        </div>
        <div class="dcfmk-gallery-settings-body" id="dcfmk-gallery-settings-body"></div>
      `;
      const settingsBody = card.querySelector(".dcfmk-gallery-settings-body");
      const visibilityToggle = card.querySelector(".dcfmk-gallery-settings-toggle");
      const syncVisibility = (collapsed) => {
        card.classList.toggle("dcfmk-gallery-settings-collapsed", collapsed);
        settingsBody.hidden = collapsed;
        visibilityToggle.textContent = collapsed ? "보이기" : "숨기기";
        visibilityToggle.setAttribute("aria-expanded", String(!collapsed));
      };
      syncVisibility(GM_getValue(SETTINGS_COLLAPSED_KEY, true) !== false);
      visibilityToggle.addEventListener("click", () => {
        const collapsed = !card.classList.contains("dcfmk-gallery-settings-collapsed");
        if (collapsed) SettingsModalView.close();
        GM_setValue(SETTINGS_COLLAPSED_KEY, collapsed);
        syncVisibility(collapsed);
      });
      settingButton.classList.add("dcfmk-gallery-settings-button");
      bundle.classList.add("dcfmk-gallery-settings-bundle");
      const settingList = bundle.querySelector(".setting_list");
      settingList?.classList.add("dcfmk-gallery-settings-list");
      if (settingList) settingList.style.display = "block";
      CustomSettingsController.mount(settingList);
      this.ensureNativeSettingsAnchor();
      card.querySelector(".dcfmk-gallery-settings-body").appendChild(bundle);
      sidebar.querySelector(".dcfmk-hotkeys")?.insertAdjacentElement("afterend", card);
      SettingsModalView.mount(card);
      return card;
    },

    mountFavoriteShortcuts(sidebar) {
      let emptyConfirmationTimer = 0;
      const card = sidebar.querySelector(".dcfmk-hotkeys");
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
        list.querySelectorAll(".dcfmk-favorite-shortcut").forEach((item) => item.remove());
        const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
        for (const [index, favorite] of (favoriteLinks || []).slice(0, keys.length).entries()) {
          const item = document.createElement("li");
          item.className = "dcfmk-favorite-shortcut";
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
      const revealCard = () => card?.classList.remove("dcfmk-hotkeys-favorites-pending");
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
      const strip = document.getElementById("dcfmk-gallery-strip");
      const initialFavorites = normalizeFavorites(strip?.__dcfmkGalleryData?.favoriteLinks || GalleryStripView.collectLinks([
        "#visit_history .bkmark_listbox a",
        "#visit_history .under_listbox.bkmark a",
      ]));
      if (initialFavorites.length > 0) applyFavorites(initialFavorites);
      else {
        if (!cacheReady && cachedFavorites.length === 0) {
          card?.classList.add("dcfmk-hotkeys-favorites-pending");
        }
        render(cachedFavorites);
        applyFavorites([]);
      }
      document.addEventListener("dcfmk:favorites-updated", (event) => {
        applyFavorites(event.detail?.favoriteLinks || []);
      });
    },

    ensureNativeSettingsAnchor() {
      if (document.querySelector("#container header .gall_issuebox")) return;
      const container = document.querySelector("#container");
      if (!container || container.querySelector(".dcfmk-native-settings-anchor")) return;
      const anchor = document.createElement("header");
      anchor.className = "dcfmk-native-settings-anchor";
      anchor.innerHTML = '<span class="gall_issuebox"></span>';
      container.prepend(anchor);
    },

    mountNativeAlarm(shell, loginLink) {
      const nativeLink = DcAdapter.nativeAlarmLink();
      const nativePanel = DcAdapter.nativeAlarmPanel();
      const mount = shell.querySelector('[data-role="nativeAlarmMount"]');
      const button = shell.querySelector('[data-role="nativeAlarm"]');
      const indicator = button.querySelector("em");

      nativePanel?.querySelector(".btn_noti_setting")?.remove();
      if (nativePanel && mount) mount.appendChild(nativePanel);

      const syncUnread = () => {
        indicator.classList.toggle("dcfmk-has-native-alarm", Boolean(nativeLink?.querySelector(".icon_noti.new")));
      };
      syncUnread();
      if (nativeLink && typeof MutationObserver === "function") {
        const observer = new MutationObserver(syncUnread);
        observer.observe(nativeLink, { attributes: true, childList: true, subtree: true });
      }

      button.addEventListener("click", () => {
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

    bindShortcuts(context, sidebar) {
      if (document.documentElement.dataset.dcfmkShortcuts === "true") return;
      document.documentElement.dataset.dcfmkShortcuts = "true";

      sidebar.querySelector('[data-role="sideComment"]')?.addEventListener("click", (event) => {
        event.preventDefault();
        const textarea = document.querySelector(".cmt_write_box textarea");
        textarea?.scrollIntoView({ behavior: "smooth", block: "center" });
        textarea?.focus({ preventScroll: true });
      });
      sidebar.querySelector('[data-role="sideComments"]')?.addEventListener("click", (event) => {
        event.preventDefault();
        document.querySelector(".dcfmk-comments")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        if (isTyping || event.ctrlKey || event.metaKey || event.shiftKey) return;

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
          const favorite = sidebar.querySelector(`.dcfmk-favorite-shortcut[data-shortcut-key="${key}"] a`);
          if (!favorite) return;
          event.preventDefault();
          favorite.click();
        }
      });
    },

    configureDirectionalShortcuts(context, previousShortcut, nextShortcut) {
      const setTarget = (control, href, label) => {
        if (!control) return;
        if (control.dataset.dcfmkDisabledGuard !== "true") {
          control.dataset.dcfmkDisabledGuard = "true";
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
      if (!control || control.dataset.dcfmkPostResolving === "true") return;
      control.dataset.dcfmkPostResolving = "true";
      const sourceHref = location.href;
      try {
        const href = await this.resolveVisiblePostHref(direction);
        if (href && location.href === sourceHref) location.assign(href);
      } finally {
        delete control.dataset.dcfmkPostResolving;
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
        elements.alarmState.classList.toggle("dcfmk-on", running);
      }
      if (elements.alarmMessage) elements.alarmMessage.textContent = message;
    },

    injectStyle() {
      if (document.getElementById("dcfmk-shell-style")) return;

      const style = document.createElement("style");
      style.id = "dcfmk-shell-style";
      style.textContent = `
        #dcfmk-shell,
        #dcfmk-sidebar {
          display: none;
        }
        html.dcfmk-enabled #top > .dcheader,
        html.dcfmk-enabled #top > .gnb_bar {
          display: none !important;
        }
        html.dcfmk-enabled #top.list_wrap,
        html.dcfmk-enabled #top.view_wrap {
          min-width: var(--dcfmk-page-width) !important;
        }
        html.dcfmk-enabled #dcfmk-shell {
          display: block;
          border-top: 1px solid #ccc;
          background: var(--dcfmk-color-surface);
          color: var(--dcfmk-color-text);
          font: 12px/1.4 var(--dcfmk-font);
        }
        html.dcfmk-enabled #dcfmk-shell * {
          box-sizing: border-box;
        }
        html.dcfmk-enabled #dcfmk-shell a {
          color: inherit;
          text-decoration: none;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-inner {
          width: var(--dcfmk-page-width);
          margin: 0 auto;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-utility {
          height: 28px;
          border-bottom: 1px solid var(--dcfmk-color-border);
          background: var(--dcfmk-color-subtle);
          color: var(--dcfmk-color-muted);
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-utility .dcfmk-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 100%;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-utility p {
          margin: 0;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-utility nav {
          display: flex;
          align-items: center;
          gap: 0;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-utility nav > * {
          border: 0;
          padding: 0 8px;
          background: transparent;
          color: var(--dcfmk-color-muted);
          font: inherit;
          cursor: pointer;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-utility nav > [hidden] {
          display: none !important;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-utility nav > * + * {
          border-left: 1px solid var(--dcfmk-color-border);
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-utility nav > .dcfmk-theme-toggle-mount {
          display: flex;
          height: 27px;
          align-items: center;
          padding: 0 8px;
          cursor: default;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-utility nav > .dcfmk-theme-toggle-mount:hover {
          color: inherit;
          text-decoration: none;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-utility .dcfmk-native-alarm-mount {
          position: relative;
          align-self: stretch;
          padding: 0;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-native-alarm-mount > [data-role="nativeAlarm"] {
          height: 27px;
          border: 0;
          padding: 0 8px;
          background: transparent;
          color: var(--dcfmk-color-muted);
          font: inherit;
          cursor: pointer;
        }
        html.dcfmk-enabled #dcfmk-shell [data-role="nativeAlarm"] em {
          display: none;
          width: 4px;
          height: 4px;
          margin: 0 0 7px 3px;
          border-radius: 50%;
          background: #d31900;
        }
        html.dcfmk-enabled #dcfmk-shell [data-role="nativeAlarm"] em.dcfmk-has-native-alarm {
          display: inline-block;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-native-alarm-mount #alarmList {
          position: absolute !important;
          z-index: 10030 !important;
          top: calc(100% + 4px) !important;
          right: 0 !important;
          left: auto !important;
          width: 420px;
          margin: 0 !important;
          text-align: left;
        }
        html.dcfmk-enabled #dcfmk-shell #alarmList .btn_noti_setting {
          display: none !important;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-utility nav > *:hover {
          color: var(--dcfmk-color-link);
          text-decoration: underline;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-brand-row {
          position: relative;
          display: flex;
          align-items: center;
          height: 82px;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-brand-slot {
          display: flex;
          min-width: 196px;
          align-items: center;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-brand {
          display: inline-flex;
          align-items: baseline;
          gap: 8px;
          color: var(--dcfmk-color-nav);
          letter-spacing: -1px;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-brand strong {
          color: var(--dcfmk-color-nav);
          font-size: 29px;
          font-style: normal;
          font-weight: 900;
          letter-spacing: -2px;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-brand span {
          color: var(--dcfmk-color-link);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-native-logo {
          position: static !important;
          top: auto !important;
          left: auto !important;
          display: flex !important;
          width: auto !important;
          height: auto !important;
          margin: 0 !important;
          align-items: center;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-native-logo a {
          display: flex !important;
          align-items: center;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-native-logo img {
          position: static !important;
          max-width: none;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-search-slot {
          width: 320px;
          margin-left: auto;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap {
          position: relative;
          inset: auto !important;
          width: 320px;
          height: 34px;
          margin: 0;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap fieldset {
          position: relative;
          width: 100%;
          height: 100%;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .auto_wordwrap {
          box-sizing: border-box;
          left: 0 !important;
          right: auto !important;
          top: 34px !important;
          width: 100% !important;
          max-width: 100%;
          margin: 0 !important;
          z-index: 20;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .auto_wordwrap .word_close {
          border-top: 1px solid #ddd;
          background: #f5f5f5 !important;
          color: #555;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .auto_wordwrap .saveonfo .round_label .inr {
          color: var(--dcfmk-color-nav-light) !important;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .top_search {
          width: 320px;
          height: 34px;
          border: 3px solid var(--dcfmk-color-nav-light);
          background: #fff;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .inner_search {
          float: left;
          width: 276px;
          height: 28px;
          margin: 0 !important;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .in_keyword {
          width: 264px;
          height: 28px;
          color: var(--dcfmk-color-text);
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .bnt_search {
          position: relative !important;
          top: 0 !important;
          right: 0 !important;
          float: right !important;
          width: 38px;
          height: 28px;
          margin: 0 !important;
          background-color: var(--dcfmk-color-nav-light) !important;
          background-image: none !important;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .bnt_search::before {
          position: absolute;
          left: 11px;
          top: 5px;
          width: 10px;
          height: 10px;
          border: 2px solid #fff;
          border-radius: 50%;
          content: "";
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .bnt_search::after {
          position: absolute;
          left: 22px;
          top: 16px;
          width: 8px;
          height: 2px;
          background: #fff;
          content: "";
          transform: rotate(45deg);
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-nav-bar {
          height: 46px;
          border: 0;
          background: transparent;
          color: #fff;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-nav-bar nav {
          display: flex;
          box-sizing: border-box;
          width: var(--dcfmk-page-width);
          align-items: flex-start;
          height: 46px;
          margin: 0 auto;
          padding-left: 12px;
          border-top: 1px solid #3b4890;
          border-bottom: 1px solid #3b4890;
          background: #3b4890;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-gallery-menu {
          position: relative;
          display: flex;
          height: 44px;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-nav-bar a {
          min-width: 0;
          height: 44px;
          margin-left: 20px;
          padding: 0;
          border: 0;
          color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", Arial, Dotum, 돋움, sans-serif;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: .025em;
          line-height: 44px;
          text-align: center;
          text-shadow: 0 -1px #1f2552;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-gallery-menu > a {
          margin-left: 0;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-nav-bar a:hover,
        html.dcfmk-enabled #dcfmk-shell .dcfmk-nav-bar a:focus-visible {
          color: #fff;
          text-decoration: underline;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-nav-bar a.dcfmk-active {
          background: transparent;
          color: #ffed44;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-category-bar {
          position: absolute;
          z-index: 10020;
          top: 44px;
          left: 0;
          display: flex;
          width: max-content;
          height: 35px;
          visibility: hidden;
          border: 1px solid #29367c;
          border-top: 0;
          background: #fff;
          box-shadow: 0 4px 10px rgba(31, 39, 90, 0.22);
          opacity: 0;
          transform: translateY(-3px);
          transition: opacity 100ms ease, transform 100ms ease, visibility 100ms;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-gallery-menu:hover .dcfmk-category-bar,
        html.dcfmk-enabled #dcfmk-shell .dcfmk-gallery-menu:focus-within .dcfmk-category-bar {
          display: flex;
          visibility: visible;
          opacity: 1;
          transform: translateY(0);
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-category-bar a {
          height: 34px;
          margin-left: 0;
          padding: 8px 18px 0;
          border-right: 1px solid #e1e2e8;
          color: #555;
          font-size: 12px;
          font-weight: 700;
          line-height: 18px;
          text-shadow: none;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-category-bar a:first-child {
          border-left: 1px solid #e1e2e8;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-category-bar a:hover {
          background: #f5f6fb;
          color: var(--dcfmk-color-link);
        }
        html.dcfmk-enabled #container > .left_content {
          float: left;
          width: var(--dcfmk-content-width) !important;
        }
        html.dcfmk-enabled.dcfmk-page-view #container > section:first-of-type {
          float: left;
          width: var(--dcfmk-content-width) !important;
        }
        html.dcfmk-enabled #container > .right_content {
          float: right;
          width: var(--dcfmk-sidebar-width) !important;
        }
        html.dcfmk-enabled #container > .right_content > :not(#dcfmk-sidebar) {
          display: none !important;
        }
        html.dcfmk-enabled.dcfmk-page-view #container > article {
          clear: both;
        }
        html.dcfmk-enabled #visit_history {
          width: var(--dcfmk-page-width);
          border-color: var(--dcfmk-color-border);
          background: var(--dcfmk-color-subtle);
        }
        html.dcfmk-enabled #dcfmk-sidebar {
          display: block;
          width: var(--dcfmk-sidebar-width);
          color: var(--dcfmk-color-text);
          font: 12px/1.45 var(--dcfmk-font);
        }
        html.dcfmk-enabled #dcfmk-sidebar * {
          box-sizing: border-box;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-side-card {
          margin-bottom: 14px;
          border: 1px solid var(--dcfmk-color-border);
          background: var(--dcfmk-color-surface);
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-side-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 26px;
          padding: 3px 10px;
          border-bottom: 1px solid var(--dcfmk-color-border);
          background: var(--dcfmk-color-subtle);
          color: #555;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-side-title button {
          border: 0;
          padding: 0;
          background: transparent;
          color: #666;
          cursor: pointer;
          font: 11px/1.4 var(--dcfmk-font);
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-side-title button:hover {
          color: var(--dcfmk-color-link);
          text-decoration: underline;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-side-title button.dcfmk-gallery-settings-toggle {
          margin-left: auto;
          color: #000;
          text-align: right;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-side-title button.dcfmk-gallery-settings-toggle:hover {
          color: #000;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-hotkeys > ul {
          display: grid;
          grid-template-columns: 1fr 1fr;
          margin: 0;
          padding: 5px 0 7px;
          list-style: none;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-hotkeys.dcfmk-hotkeys-favorites-pending {
          visibility: hidden;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-hotkeys li {
          display: flex;
          min-width: 0;
          align-items: center;
          height: 20px;
          padding: 2px 4px;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-hotkeys li:has(
          [data-role="sideGallery"],
          [data-role="sideMinor"],
          [data-role="sideMini"],
          [data-role="sidePerson"]
        ) {
          display: none !important;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-hotkeys kbd {
          flex: 0 0 auto;
          min-width: 27px;
          height: 15px;
          margin-right: 4px;
          border: 1px solid #ddd;
          background: #eee;
          color: #666;
          font: 700 10px/13px monospace;
          text-align: center;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-hotkeys a,
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-hotkeys li > button {
          min-width: 0;
          overflow: hidden;
          border: 0;
          padding: 0;
          background: transparent;
          color: #666;
          font: 11px/1.4 var(--dcfmk-font);
          text-decoration: none;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-hotkeys a:hover,
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-hotkeys li > button:hover {
          color: var(--dcfmk-color-link);
          text-decoration: underline;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings {
          position: relative;
          overflow: visible;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-body {
          position: relative;
          padding: 0;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-body[hidden] {
          display: none !important;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-collapsed > .dcfmk-side-title {
          border-bottom: 0;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle {
          position: relative !important;
          float: none !important;
          width: 100%;
          margin: 0 !important;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-button {
          display: none !important;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle > .new {
          display: none !important;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list {
          position: static !important;
          display: block !important;
          width: 100% !important;
          margin: 0 !important;
          border: 0;
          background: #fff;
          box-shadow: none;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list .inner {
          padding: 4px 0;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list ul {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list li {
          min-height: 27px;
          margin: 0;
          border-bottom: 1px solid #eee;
          padding: 0;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list li:last-child {
          border-bottom: 0;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list li.dcfmk-custom-setting:nth-child(3) {
          border-bottom-color: #d5d8e2;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list li > button,
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list li > span {
          display: flex;
          box-sizing: border-box;
          width: 100%;
          min-height: 27px;
          align-items: center;
          border: 0;
          padding: 5px 9px;
          background: #fff;
          color: #555;
          font: 11px/17px var(--dcfmk-font);
          text-align: left;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list li > button:hover {
          background: #f5f6fb;
          color: var(--dcfmk-color-link);
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list li > .checkbox:hover {
          background: #f5f6fb;
          color: var(--dcfmk-color-link);
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list .checkbox {
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
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list .checkbox label {
          min-width: 0;
          flex: 1 1 auto;
          overflow: hidden;
          color: inherit;
          text-overflow: ellipsis;
          white-space: nowrap;
          cursor: pointer;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list .checkbox input[type="checkbox"] {
          position: absolute !important;
          width: 1px !important;
          height: 1px !important;
          margin: -1px !important;
          opacity: 0;
          overflow: hidden;
          pointer-events: none;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list .checkbox .checkmark {
          position: relative !important;
          right: auto !important;
          bottom: auto !important;
          display: inline-block;
          flex: 0 0 14px;
          width: 14px !important;
          height: 14px !important;
          margin: 0 !important;
          border: 1px solid #aaa !important;
          border-radius: 2px;
          background: #fff !important;
          background-image: none !important;
          cursor: pointer;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-gallery-settings-bundle .setting_list .checkbox input[type="checkbox"]:checked + .checkmark {
          border-color: var(--dcfmk-color-nav-light) !important;
          background: var(--dcfmk-color-nav-light) !important;
        }
        html.dcfmk-enabled #dcfmk-sidebar [data-role="alarmState"] {
          color: #999;
          font-size: 11px;
          font-weight: 700;
        }
        html.dcfmk-enabled #dcfmk-sidebar [data-role="alarmState"].dcfmk-on {
          color: var(--dcfmk-color-accent);
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-alarm-summary p {
          margin: 0;
          padding: 10px 9px 5px;
          overflow: hidden;
          color: var(--dcfmk-color-text);
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-alarm-summary small {
          display: block;
          padding: 0 9px 10px;
          color: var(--dcfmk-color-muted);
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-side-links {
          margin: 0;
          padding: 5px 9px 8px;
          list-style: none;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-side-links li {
          border-bottom: 1px dotted var(--dcfmk-color-border);
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-side-links li:last-child {
          border-bottom: 0;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-side-links a {
          display: block;
          padding: 6px 2px;
          color: #555;
          text-decoration: none;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-side-links a:hover {
          color: var(--dcfmk-color-link);
          text-decoration: underline;
        }
        html.dcfmk-enabled #dcfmk-sidebar .dcfmk-version-card {
          display: flex;
          justify-content: space-between;
          padding: 8px 9px;
          color: var(--dcfmk-color-muted);
        }
        html.dcfmk-enabled #visit_history {
          display: none !important;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-brand strong b {
          color: #444;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-brand strong em {
          color: #4778c7;
          font-style: normal;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-brand span {
          color: #777;
          font-size: 12px;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-search-slot,
        html.dcfmk-enabled #dcfmk-shell #search_wrap,
        html.dcfmk-enabled #dcfmk-shell #search_wrap .top_search {
          width: 255px;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .top_search {
          display: flex;
          align-items: center;
          border: 0;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .inner_search {
          box-sizing: border-box;
          width: 211px;
          height: 30px;
          border: 3px solid var(--dcfmk-color-nav-light);
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .in_keyword {
          box-sizing: border-box;
          width: 205px;
          height: 24px;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .bnt_search {
          width: 39px;
          height: 28px;
          margin-left: 5px !important;
          border: 1px solid #ccc !important;
          border-radius: 3px;
          background: linear-gradient(to bottom, #fff 0, #f3f3f3 100%) !important;
          color: #333;
          font-size: 0;
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .bnt_search::before {
          position: static;
          display: block;
          width: auto;
          height: auto;
          border: 0;
          border-radius: 0;
          color: #333;
          font: 12px/26px var(--dcfmk-font);
          content: "검색";
        }
        html.dcfmk-enabled #dcfmk-shell #search_wrap .bnt_search::after {
          display: none;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-nav-spacer {
          flex: 1;
        }
        html.dcfmk-enabled #dcfmk-shell .dcfmk-nav-bar a[data-role="allBoards"],
        html.dcfmk-enabled #dcfmk-shell .dcfmk-nav-bar a[data-role="favorites"] {
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
      if (!card || document.getElementById("dcfmk-settings-modal")) return;

      const overlay = document.createElement("div");
      overlay.id = "dcfmk-settings-modal";
      overlay.hidden = true;
      overlay.innerHTML = '<section class="dcfmk-settings-modal-dialog" role="dialog" aria-modal="false" aria-labelledby="dcfmk-settings-modal-title" data-placement="right"><header><strong id="dcfmk-settings-modal-title">설정</strong><button type="button" class="dcfmk-settings-modal-close" aria-label="설정 패널 닫기">×</button></header><div class="dcfmk-settings-modal-host"></div></section>';
      document.body.appendChild(overlay);

      card.addEventListener("pointerdown", (event) => {
        const button = event.target.closest(".setting_list li button");
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
        const button = event.target.closest(".setting_list li button");
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
          || item?.classList.contains("dcfmk-settings-trigger-active")
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
        const button = event.target.closest(".setting_list li button");
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
      overlay.querySelector(".dcfmk-settings-modal-close")?.addEventListener("click", () => this.close());
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
        const host = overlay.querySelector(".dcfmk-settings-modal-host");
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
            && (node.classList.contains("dcfmk-native-settings-auxiliary")
              || node.classList.contains("dcfmk-native-settings-nested")));
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
        if (event.target.closest("#dcfmk-settings-modal .dcfmk-settings-modal-dialog")) return;
        if (event.target.closest("#dcfmk-sidebar .dcfmk-gallery-settings")) return;
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
      document.querySelectorAll(".dcfmk-settings-trigger-active")
        .forEach((node) => node.classList.remove("dcfmk-settings-trigger-active"));
      settingsModalLastTrigger?.closest("li")?.classList.add("dcfmk-settings-trigger-active");
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
      const overlay = document.getElementById("dcfmk-settings-modal");
      const host = overlay?.querySelector(".dcfmk-settings-modal-host");
      if (!overlay || !host) return;
      overlay.querySelector("#dcfmk-settings-modal-title").textContent = label || "설정";
      overlay.querySelector(".dcfmk-settings-modal-dialog").dataset.source = "";
      host.innerHTML = '<div class="dcfmk-settings-loading" role="status">설정을 불러오는 중입니다.</div>';
      overlay.hidden = false;
      this.positionPanel();
    },

    showLoadFailure(label) {
      if (settingsModalState) return;
      const overlay = document.getElementById("dcfmk-settings-modal");
      const host = overlay?.querySelector(".dcfmk-settings-modal-host");
      if (!overlay || overlay.hidden || !host) return;
      overlay.querySelector("#dcfmk-settings-modal-title").textContent = label || "설정";
      host.innerHTML = '<div class="dcfmk-settings-loading dcfmk-settings-load-failed">설정 데이터를 불러오지 못했습니다.<small>로그인 상태나 네트워크 연결을 확인한 뒤 다시 눌러 주세요.</small></div>';
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
        if (node.closest("#dcfmk-sidebar, #dcfmk-settings-modal, #alarmList")) return false;
        if (["relation_popup", "visit_history_lyr", "my_favorite"].includes(node.id)) return false;
        return this.isVisible(node);
      });
    },

    findPopup(label) {
      return this.knownPopup(label) || this.popupCandidates()[0] || null;
    },

    open(source, label) {
      const overlay = document.getElementById("dcfmk-settings-modal");
      const host = overlay?.querySelector(".dcfmk-settings-modal-host");
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
      overlay.querySelector("#dcfmk-settings-modal-title").textContent = nativeTitle || label || "설정";
      overlay.querySelector(".dcfmk-settings-modal-dialog").dataset.source = source.id || "";
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
      const overlay = document.getElementById("dcfmk-settings-modal");
      const dialog = overlay?.querySelector(".dcfmk-settings-modal-dialog");
      const trigger = settingsModalLastTrigger;
      if (!dialog || !trigger?.isConnected) return;
      const anchor = trigger.closest("li") || trigger;
      const card = trigger.closest(".dcfmk-gallery-settings") || trigger.closest("#dcfmk-sidebar") || anchor;
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
      const host = document.querySelector("#dcfmk-settings-modal .dcfmk-settings-modal-host");
      if (!host || !node || settingsModalState?.entries.some((entry) => entry.node === node)) return;
      settingsModalState.entries.push({
        node,
        parent: node.parentNode,
        nextSibling: node.nextSibling,
        style: node.getAttribute("style"),
      });
      node.classList.add("dcfmk-native-settings-layer");
      node.classList.toggle("dcfmk-native-settings-auxiliary", auxiliary);
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
        node.classList.add("dcfmk-native-settings-nested");
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
        const measuredBase = node.dataset.dcfmkFitBaseFont
          ? Number.parseFloat(node.dataset.dcfmkFitBaseFont)
          : Math.min(computedSize, 9);
        if (!Number.isFinite(measuredBase) || measuredBase <= 0) return;
        if (!node.dataset.dcfmkFitBaseFont) node.dataset.dcfmkFitBaseFont = String(measuredBase);
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
      const overlay = document.getElementById("dcfmk-settings-modal");
      const state = settingsModalState;
      const closingUserMemo = settingsUserMemoOpen
        || settingsModalLastTrigger?.id === "btn_user_memo_set"
        || state?.primary?.matches?.("#user_memo_config");
      if (closingUserMemo) settingsUserMemoOpen = false;
      if (!state) {
        if (overlay) overlay.hidden = true;
        overlay?.querySelector(".dcfmk-settings-modal-host")?.replaceChildren();
        document.querySelectorAll(".dcfmk-settings-trigger-active")
          .forEach((node) => node.classList.remove("dcfmk-settings-trigger-active"));
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
        node.classList.remove("dcfmk-native-settings-layer", "dcfmk-native-settings-auxiliary");
        node.querySelectorAll(".dcfmk-native-settings-nested")
          .forEach((nested) => nested.classList.remove("dcfmk-native-settings-nested"));
        if (style == null) node.removeAttribute("style");
        else node.setAttribute("style", style);
        if (!node.isConnected) continue;
        if (parent?.isConnected) parent.insertBefore(node, nextSibling?.isConnected ? nextSibling : null);
        else document.body.appendChild(node);
        node.style.display = "none";
      }
      overlay.hidden = true;
      overlay.querySelector(".dcfmk-settings-modal-host")?.replaceChildren();
      settingsModalState = null;
      document.querySelectorAll(".dcfmk-settings-trigger-active")
        .forEach((node) => node.classList.remove("dcfmk-settings-trigger-active"));
      if (settingsModalLastTrigger?.isConnected) settingsModalLastTrigger.focus({ preventScroll: true });
      settingsModalLastTrigger = null;
    },

    injectStyle() {
      if (document.getElementById("dcfmk-settings-modal-style")) return;
      const style = document.createElement("style");
      style.id = "dcfmk-settings-modal-style";
      style.textContent = `
        #dcfmk-settings-modal {
          position: fixed;
          z-index: 12000;
          inset: 0;
          box-sizing: border-box;
          background: transparent;
          font-family: var(--dcfmk-font);
          pointer-events: none;
        }
        .dcfmk-native-settings-anchor {
          display: contents;
        }
        .dcfmk-native-settings-anchor > .gall_issuebox {
          display: none !important;
        }
        #dcfmk-settings-modal[hidden] {
          display: none;
        }
        #dcfmk-settings-modal .dcfmk-settings-modal-dialog {
          position: fixed;
          display: grid;
          grid-template-rows: 28px minmax(0, 1fr);
          box-sizing: border-box;
          border: 1px solid #b9bcc7;
          border-top: 2px solid var(--dcfmk-color-nav-light);
          border-radius: 0;
          background: #fff;
          box-shadow: 0 3px 12px rgba(28, 32, 52, 0.18);
          overflow: hidden;
          pointer-events: auto;
          font: 8px/1.25 var(--dcfmk-font);
        }
        #dcfmk-settings-modal .dcfmk-settings-modal-dialog > header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 6px 0 8px;
          border-bottom: 1px solid #c9c9c9;
          background: #f4f5fa;
          color: #29367c;
          font-size: 10px;
        }
        #dcfmk-settings-modal .dcfmk-settings-modal-close {
          width: 20px;
          height: 20px;
          border: 0;
          padding: 0;
          background: transparent;
          color: #777;
          font: 16px/20px Arial, sans-serif;
          cursor: pointer;
        }
        #dcfmk-settings-modal .dcfmk-settings-modal-close:hover {
          color: var(--dcfmk-color-link);
        }
        #dcfmk-settings-modal .dcfmk-settings-modal-dialog[data-source="user_memo_config"] .dcfmk-settings-modal-close {
          display: none !important;
        }
        #dcfmk-settings-modal #user_memo_config > .pop_content > .poply_whiteclose {
          display: none !important;
        }
        #dcfmk-settings-modal .dcfmk-settings-modal-host {
          min-height: 0;
          overflow: auto;
          padding: 4px;
          background: #fff;
        }
        #dcfmk-settings-modal .dcfmk-settings-loading {
          min-height: 54px;
          box-sizing: border-box;
          padding: 13px 9px;
          border: 1px solid #e0e1e7;
          background: #fafafa;
          color: #666;
          font-size: 9px;
          text-align: center;
        }
        #dcfmk-settings-modal .dcfmk-settings-loading small {
          display: block;
          margin-top: 4px;
          color: #999;
          font-size: 8px;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer,
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .pop_content {
          box-sizing: border-box;
          max-width: 100%;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer {
          min-width: 0 !important;
          border: 0 !important;
          background: transparent !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .pop_content,
        #dcfmk-settings-modal .dcfmk-native-settings-layer.pop_content {
          position: static !important;
          width: 100% !important;
          min-width: 0 !important;
          height: auto !important;
          margin: 0 !important;
          border: 1px solid #d2d2d2 !important;
          background: #fff !important;
          color: #444;
          font: 8px/1.25 var(--dcfmk-font) !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .pop_content > .pop_head:first-child,
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .poply_whiteclose,
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .poply_bgblueclose,
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .poply_greyclose,
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .poply_bgclose,
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .poply_close,
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .pop_content > .poply_whiteclose,
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .pop_content > .poply_bgblueclose,
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .pop_content > .poply_greyclose,
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .pop_content > .poply_bgclose,
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .pop_content > .poply_close {
          display: none !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .inner {
          box-sizing: border-box;
          max-width: 100%;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .pop_content > .inner,
        #dcfmk-settings-modal .dcfmk-native-settings-layer.pop_content > .inner {
          width: 100% !important;
          padding: 5px 6px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer button,
        #dcfmk-settings-modal .dcfmk-native-settings-layer input,
        #dcfmk-settings-modal .dcfmk-native-settings-layer textarea,
        #dcfmk-settings-modal .dcfmk-native-settings-layer select {
          font-family: var(--dcfmk-font) !important;
          font-size: 8px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer p,
        #dcfmk-settings-modal .dcfmk-native-settings-layer h4,
        #dcfmk-settings-modal .dcfmk-native-settings-layer label,
        #dcfmk-settings-modal .dcfmk-native-settings-layer li,
        #dcfmk-settings-modal .dcfmk-native-settings-layer a {
          font-size: 8px !important;
          line-height: 1.25 !important;
          word-break: keep-all;
          overflow-wrap: break-word;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .cont_tit {
          font-size: 8px !important;
          line-height: 1.25 !important;
          white-space: nowrap;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tabcontent,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tabbox,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .set_cont,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .scrollarea,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .textarea_box,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .sch_box {
          box-sizing: border-box;
          max-width: 100%;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer textarea,
        #dcfmk-settings-modal .dcfmk-native-settings-layer input[type="text"] {
          box-sizing: border-box;
          max-width: 100%;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer input[type="text"],
        #dcfmk-settings-modal .dcfmk-native-settings-layer select {
          height: 22px !important;
          min-height: 22px !important;
          padding: 2px 4px !important;
          line-height: 16px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox {
          display: flex;
          box-sizing: border-box !important;
          width: 100% !important;
          height: 23px !important;
          min-height: 23px !important;
          margin: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          border-bottom: 1px solid var(--dcfmk-color-nav-light) !important;
          background: #f5f5f5 !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox button {
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
          border-right: 1px solid #d5d5d5 !important;
          padding: 0 5px !important;
          background: #f5f5f5 !important;
          color: #555 !important;
          font: 8px/21px var(--dcfmk-font) !important;
          cursor: pointer;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox button:last-child {
          border-right: 0 !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox button.on {
          position: relative;
          height: 23px !important;
          margin-bottom: 0 !important;
          border: 1px solid var(--dcfmk-color-nav-light) !important;
          border-bottom-color: #fff !important;
          background: #fff !important;
          color: var(--dcfmk-color-link) !important;
          font-weight: 700 !important;
          z-index: 1;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox button p {
          display: block !important;
          margin: 0 !important;
          padding: 0 !important;
          font: inherit !important;
          white-space: nowrap !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox button .gallname,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox button p.gallname {
          display: none !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox + .inner {
          margin: 0 !important;
          padding: 4px 6px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox + .inner > .tabcontent,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox + .inner > .tabcontent > .tabbox {
          margin-top: 0 !important;
          padding-top: 0 !important;
        }
        #dcfmk-settings-modal #user_memo_setting > .tabbox,
        #dcfmk-settings-modal #user_memo_cont,
        #dcfmk-settings-modal #autozzal_setting_pop .tabcontent,
        #dcfmk-settings-modal #headTail_lay .tabcontent {
          margin-top: 0 !important;
          padding-top: 0 !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .btn_box {
          box-sizing: border-box;
          max-width: 100%;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .btn_box > button {
          min-width: 44px !important;
          height: 22px !important;
          padding: 0 7px !important;
          line-height: 20px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .pop_content > .btn_box,
        #dcfmk-settings-modal .dcfmk-native-settings-layer.pop_content > .btn_box {
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
          border-top: 1px solid #d5d5d5;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .pop_info {
          box-sizing: border-box;
          min-height: 0 !important;
          padding: 5px 6px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .pop_bg {
          display: none !important;
        }
        #dcfmk-settings-modal #user_memo_config .umome_wrap,
        #dcfmk-settings-modal #user_memo_setting,
        #dcfmk-settings-modal #user_memo_setting > .tabbox,
        #dcfmk-settings-modal #user_memo_cont,
        #dcfmk-settings-modal #user_memo_table,
        #dcfmk-settings-modal #user_memo_search {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
        #dcfmk-settings-modal #user_memo_cont > .inr,
        #dcfmk-settings-modal #user_memo_table > .inr.flex {
          display: flex !important;
          width: 100% !important;
          align-items: center;
          gap: 5px;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }
        #dcfmk-settings-modal #user_memo_cont .cont_tit,
        #dcfmk-settings-modal #user_memo_table .cont_tit {
          min-width: 0;
          margin: 0 !important;
          font-size: 8px !important;
        }
        #dcfmk-settings-modal #user_memo_cont .textarea_box,
        #dcfmk-settings-modal #user_memo_cont textarea {
          width: 100% !important;
        }
        #dcfmk-settings-modal #user_memo_cont textarea {
          min-height: 44px !important;
          padding: 4px !important;
          line-height: 1.3 !important;
          resize: vertical;
        }
        #dcfmk-settings-modal #user_memo_cont .info_txt {
          margin-top: 5px !important;
          font-size: 8px !important;
          word-break: keep-all;
        }
        #dcfmk-settings-modal #user_memo_cont .info_txt p {
          margin: 1px 0 !important;
        }
        #dcfmk-settings-modal #user_memo_table > .inr.flex {
          flex-wrap: wrap;
        }
        #dcfmk-settings-modal #user_memo_table .btn_tabbox {
          margin-left: auto;
          white-space: nowrap;
        }
        #dcfmk-settings-modal #user_memo_table .btn_txtbox {
          white-space: nowrap;
        }
        #dcfmk-settings-modal #user_memo_table .btn_txtbox.copydel > button {
          box-sizing: border-box !important;
          min-height: 22px !important;
          height: 22px !important;
          margin: 0 !important;
          padding: 0 6px !important;
          border: 1px solid #d2d2d2 !important;
          line-height: 20px !important;
        }
        #dcfmk-settings-modal #user_memo_table .memo_list {
          box-sizing: border-box;
          width: 100% !important;
          max-width: 100% !important;
          max-height: 125px;
          margin: 0 !important;
          padding: 0 !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
        }
        #dcfmk-settings-modal #user_memo_table .memo_list li {
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
        #dcfmk-settings-modal #user_memo_table .memo_list li::after {
          top: 50vh !important;
          bottom: auto !important;
        }
        #dcfmk-settings-modal #user_memo_table .memo_list .btn-wrap,
        #dcfmk-settings-modal #user_memo_table .memo_list .btn-wrap > .btn {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          min-height: 18px !important;
          height: 18px !important;
          margin: 0 !important;
          padding: 0 3px !important;
          text-align: left !important;
        }
        #dcfmk-settings-modal #user_memo_table .memo_list .checkbox {
          display: flex !important;
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          align-items: center !important;
          gap: 2px;
        }
        #dcfmk-settings-modal #user_memo_table .memo_list label,
        #dcfmk-settings-modal #user_memo_table .memo_list .nik,
        #dcfmk-settings-modal #user_memo_table .memo_list .mone {
          display: inline !important;
          margin: 0 !important;
          padding: 0 !important;
          font: 8px/18px var(--dcfmk-font) !important;
          white-space: nowrap !important;
        }
        #dcfmk-settings-modal #user_memo_search {
          display: flex !important;
          align-items: stretch;
          gap: 4px;
          min-height: 22px !important;
          height: 22px !important;
          margin: 4px 0 0 !important;
          padding: 0 !important;
        }
        #dcfmk-settings-modal #user_memo_search .array_latest {
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
        #dcfmk-settings-modal #user_memo_search .array_latest > .select_area {
          position: relative !important;
          display: block !important;
          width: 60px !important;
          min-width: 60px !important;
          max-width: 60px !important;
          margin: 0 !important;
          transform: none !important;
          overflow: hidden !important;
        }
        #dcfmk-settings-modal #user_memo_search .intbox {
          display: flex !important;
          min-width: 0;
          flex: 1;
          width: auto !important;
          margin: 0 !important;
        }
        #dcfmk-settings-modal #user_memo_search .intbox input {
          min-width: 0;
          width: 100% !important;
          flex: 1;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer :is(.select_box, .ul_selectric),
        #dcfmk-settings-modal .dcfmk-native-settings-layer .select_area,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .intbox,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .intbox > :is(input, button) {
          box-sizing: border-box !important;
          min-height: 22px !important;
          height: 22px !important;
          line-height: 20px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .select_area {
          position: relative !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 18px 0 5px !important;
          overflow: hidden !important;
          white-space: nowrap !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .select_area > .icon_option_more {
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
        #dcfmk-settings-modal .dcfmk-native-settings-layer .intbox {
          display: flex !important;
          min-width: 0 !important;
          align-items: stretch !important;
          gap: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .intbox > input {
          min-width: 0 !important;
          flex: 1 1 auto;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .intbox > button {
          flex: 0 0 auto;
          margin: 0 !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer :is(
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
        #dcfmk-settings-modal #trusted_site_config .inner,
        #dcfmk-settings-modal #trusted_site_table {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
        }
        #dcfmk-settings-modal #trusted_site_config .trusted_site_wrap > .inner {
          height: auto !important;
          min-height: 0 !important;
          max-height: 270px !important;
          overflow: auto !important;
        }
        #dcfmk-settings-modal #trusted_site_config .scrollarea {
          height: auto !important;
          max-height: 260px !important;
          overflow: auto !important;
        }
        #dcfmk-settings-modal #trusted_site_config .empty_box {
          display: flex;
          box-sizing: border-box !important;
          min-height: 110px !important;
          height: 110px !important;
          align-items: center;
          justify-content: center;
        }
        #dcfmk-settings-modal #trusted_site_table .site_list {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        #dcfmk-settings-modal #trusted_site_table .site_list li {
          display: flex;
          min-height: 23px;
          align-items: center;
          gap: 3px;
          border-bottom: 1px solid #ececec;
          padding: 0 3px;
        }
        #dcfmk-settings-modal #trusted_site_table .site_list p {
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
        #dcfmk-settings-modal #trusted_site_table .site_list .del {
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
          color: #777;
          font: 8px/1.3 var(--dcfmk-font);
          text-indent: 0 !important;
          white-space: nowrap !important;
          word-break: keep-all !important;
          overflow-wrap: normal !important;
          cursor: pointer;
        }
        #dcfmk-settings-modal #trusted_site_table .site_list .del:hover {
          color: var(--dcfmk-color-link);
          text-decoration: underline;
        }
        #dcfmk-settings-modal #user_block .block_setting_box,
        #dcfmk-settings-modal #user_block .block_setting_box > .inner,
        #dcfmk-settings-modal #user_block .tabcontent,
        #dcfmk-settings-modal #user_block .pop_info,
        #dcfmk-settings-modal #user_block .word_wrap,
        #dcfmk-settings-modal #user_block .set_cont,
        #dcfmk-settings-modal #user_block .block_list {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
        #dcfmk-settings-modal #user_block .block_setting_box,
        #dcfmk-settings-modal #user_block .block_setting_box > .inner,
        #dcfmk-settings-modal #user_block .tabcontent,
        #dcfmk-settings-modal #user_block .word_wrap {
          min-height: 0 !important;
          height: auto !important;
        }
        #dcfmk-settings-modal #user_block .tabcontent {
          padding-left: 0 !important;
          padding-right: 0 !important;
          overflow-x: hidden !important;
        }
        #dcfmk-settings-modal #user_block .block_tab {
          display: flex !important;
          box-sizing: border-box !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        #dcfmk-settings-modal #user_block .block_tab button {
          width: auto !important;
          min-width: 0 !important;
          height: 23px !important;
          flex: 1 1 0;
          margin: 0 !important;
          padding: 0 5px !important;
          line-height: 21px !important;
        }
        #dcfmk-settings-modal #user_block,
        #dcfmk-settings-modal #user_block button,
        #dcfmk-settings-modal #user_block input,
        #dcfmk-settings-modal #user_block label,
        #dcfmk-settings-modal #user_block p,
        #dcfmk-settings-modal #user_block h4 {
          font-size: 8px !important;
          line-height: 1.25 !important;
        }
        #dcfmk-settings-modal #user_block .pop_content.block_setting_wrap {
          overflow: hidden !important;
        }
        #dcfmk-settings-modal #user_block .pop_content > .pop_info {
          min-height: 0 !important;
          padding: 4px 6px !important;
        }
        #dcfmk-settings-modal #user_block .pop_content > .pop_info p,
        #dcfmk-settings-modal #user_block .tabcontent > .pop_info h4,
        #dcfmk-settings-modal #user_block .tabcontent > .pop_info p {
          width: auto !important;
          margin: 0 !important;
        }
        #dcfmk-settings-modal #user_block .all_setting > .pop_info,
        #dcfmk-settings-modal #user_block .part_setting > .part_schbox + .pop_info {
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
        #dcfmk-settings-modal #user_block .all_setting > .pop_info h4,
        #dcfmk-settings-modal #user_block .part_setting > .part_schbox + .pop_info h4 {
          grid-area: block-title;
          display: inline-flex !important;
          align-items: center;
          white-space: nowrap;
        }
        #dcfmk-settings-modal #user_block .part_setting > .part_schbox + .pop_info h4 .icon_mini,
        #dcfmk-settings-modal #user_block .part_setting > .part_schbox + .pop_info h4 .icon_person {
          display: none !important;
        }
        #dcfmk-settings-modal #user_block .all_setting > .pop_info p,
        #dcfmk-settings-modal #user_block .part_setting > .part_schbox + .pop_info p {
          grid-area: block-description;
          min-width: 0;
          padding-right: 0 !important;
          word-break: keep-all;
          overflow-wrap: normal;
        }
        #dcfmk-settings-modal #user_block .all_setting > .pop_info .setting_onoff,
        #dcfmk-settings-modal #user_block .part_setting > .part_schbox + .pop_info .setting_onoff {
          position: static !important;
          grid-area: block-switch;
          width: 66px !important;
          margin: 0 !important;
          justify-self: end;
          align-self: center;
        }
        #dcfmk-settings-modal #user_block .word_wrap {
          padding: 0 6px !important;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text {
          grid-template-columns: 70px minmax(0, 1fr) 40px;
          min-height: 35px !important;
          height: auto !important;
          padding: 6px 0 !important;
          border-bottom: 1px dashed #d7d7d7;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text .cont_tit {
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
        #dcfmk-settings-modal #user_block .set_cont.add_text .intxt,
        #dcfmk-settings-modal #user_block .part_schbox .set_cont .intxt {
          box-sizing: border-box !important;
          width: 100% !important;
          min-width: 0 !important;
          height: 22px !important;
          padding: 2px 4px !important;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text .btn_enroll,
        #dcfmk-settings-modal #user_block .part_schbox .set_cont .btn_enroll {
          box-sizing: border-box !important;
          width: 40px !important;
          min-width: 40px !important;
          height: 22px !important;
          padding: 0 4px !important;
          line-height: 20px !important;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text .block_list:empty {
          display: none !important;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text .block_list:not(:empty) {
          display: flex !important;
          flex-wrap: wrap;
          gap: 3px 6px;
          min-height: 0 !important;
          height: auto !important;
          padding: 4px 0 0 !important;
        }
        #dcfmk-settings-modal #user_block .part_setting > .pop_info:first-child {
          display: block !important;
          min-height: 0 !important;
          padding: 5px 6px !important;
        }
        #dcfmk-settings-modal #user_block .part_setting > .pop_info:first-child h4 {
          margin-bottom: 4px !important;
          white-space: nowrap;
        }
        #dcfmk-settings-modal #user_block .block_list.gall {
          display: flex !important;
          flex-wrap: wrap;
          align-items: center;
          gap: 3px 7px;
          max-height: 58px;
          overflow: auto;
          padding: 0 !important;
        }
        #dcfmk-settings-modal #user_block .block_list.gall li,
        #dcfmk-settings-modal #user_block .block_list.gall li > span {
          display: inline-flex !important;
          width: auto !important;
          align-items: center;
          white-space: nowrap;
        }
        #dcfmk-settings-modal #user_block .block_list.gall li {
          min-height: 16px !important;
          height: 16px !important;
          gap: 2px;
          margin: 0 !important;
          padding: 0 !important;
          font-size: 8px !important;
          line-height: 16px !important;
        }
        #dcfmk-settings-modal #user_block .block_list.gall li > span {
          min-width: 0;
          height: 16px !important;
          font: 8px/16px var(--dcfmk-font) !important;
        }
        #dcfmk-settings-modal #user_block .block_list.gall .icon_mini,
        #dcfmk-settings-modal #user_block .block_list.gall .icon_person {
          display: none !important;
        }
        #dcfmk-settings-modal #user_block .block_list.gall li > button {
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
        #dcfmk-settings-modal #user_block .part_schbox {
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
        #dcfmk-settings-modal #user_block .part_schbox + .pop_info {
          margin-top: 5px !important;
          border-top: 1px solid #d7d7d7;
        }
        #dcfmk-settings-modal #user_block .part_schbox .fl {
          float: none !important;
        }
        #dcfmk-settings-modal #user_block .part_schbox .gall_sel_tit {
          grid-area: gallery-title;
          margin: 0 !important;
          white-space: nowrap;
          align-self: center;
        }
        #dcfmk-settings-modal #user_block .part_schbox > .fl:not(.gall_sel_tit):not(.set_cont) {
          grid-area: gallery-types;
          display: flex !important;
          min-width: 0;
          align-items: center;
          gap: 7px;
          white-space: nowrap;
        }
        #dcfmk-settings-modal #user_block .part_schbox .radiobox,
        #dcfmk-settings-modal #user_block .part_schbox .radiobox label {
          display: inline-flex !important;
          align-items: center;
          white-space: nowrap;
        }
        #dcfmk-settings-modal #user_block .part_schbox .radiobox {
          position: relative !important;
          height: 16px !important;
          gap: 2px;
          padding: 0 !important;
        }
        #dcfmk-settings-modal #user_block .part_schbox .radiobox input {
          position: absolute !important;
          width: 12px !important;
          height: 12px !important;
          margin: 0 !important;
          opacity: 0;
          cursor: pointer;
        }
        #dcfmk-settings-modal #user_block .part_schbox .radiobox .checkmark {
          position: static !important;
          display: inline-block !important;
          order: -1;
          box-sizing: border-box !important;
          width: 10px !important;
          height: 10px !important;
          margin: 0 !important;
          border: 1px solid #a9a9a9 !important;
          border-radius: 50%;
          background: #fff !important;
        }
        #dcfmk-settings-modal #user_block .part_schbox .radiobox input:checked + .checkmark {
          border-color: var(--dcfmk-color-nav-light) !important;
          background: var(--dcfmk-color-nav-light) !important;
          box-shadow: inset 0 0 0 2px #fff;
        }
        #dcfmk-settings-modal #user_block .part_schbox > .set_cont {
          grid-area: gallery-search;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) 40px;
          gap: 4px;
          min-height: 0 !important;
          padding: 0 !important;
        }
        #dcfmk-settings-modal #user_block .part_schbox .block_sch_gall {
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
        #dcfmk-settings-modal #user_block .part_schbox .block_sch_gall:empty {
          display: none !important;
        }
        #dcfmk-settings-modal #user_block .part_schbox .block_sch_gall:not(:empty) {
          display: block !important;
          border: 1px solid #d4d4d4;
          padding: 3px 5px !important;
        }
        #dcfmk-settings-modal #user_block .part_schbox .block_sch_gall li {
          min-height: 18px !important;
          margin: 0 !important;
          padding: 0 !important;
          font: 8px/18px var(--dcfmk-font) !important;
        }
        #dcfmk-settings-modal #user_block .part_schbox .empty_sch_gall {
          grid-area: gallery-empty;
          margin: 0 !important;
        }
        #dcfmk-settings-modal #user_block .pop_content.block_setting_wrap > .btn_box {
          position: static !important;
          display: flex !important;
          min-height: 30px !important;
          height: 30px !important;
          align-items: center;
          justify-content: center;
          gap: 4px;
          margin: 0 !important;
          padding: 4px 6px !important;
          border-top: 1px solid #d5d5d5;
        }
        #dcfmk-settings-modal #autozzal_setting_pop .jjalbang_set,
        #dcfmk-settings-modal #autozzal_setting_pop .tabcontent,
        #dcfmk-settings-modal #autozzal_setting_pop .scrollarea,
        #dcfmk-settings-modal #headTail_lay .txtmark_setting_wrap,
        #dcfmk-settings-modal #headTail_lay .tabcontent,
        #dcfmk-settings-modal #headTail_lay .tabbox,
        #dcfmk-settings-modal #headTail_lay .set_cont {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
        #dcfmk-settings-modal #autozzal_setting_pop .jjalbang_list img,
        #dcfmk-settings-modal #autozzal_setting_pop .jjalbang_list .jjal {
          max-width: 125px !important;
          max-height: 125px !important;
          object-fit: contain;
        }
        #dcfmk-settings-modal #autozzal_setting_pop #autozzal_setting > .inner,
        #dcfmk-settings-modal #autozzal_setting_pop #autozzal_setting > .inner > .tabcontent,
        #dcfmk-settings-modal #autozzal_setting_pop .jjalbang_set .scrollarea,
        #dcfmk-settings-modal #autozzal_setting_pop .jjalbang_set .empty_box {
          height: auto !important;
          min-height: 0 !important;
        }
        #dcfmk-settings-modal #autozzal_setting_pop #autozzal_setting > .inner {
          max-height: 330px !important;
          overflow: auto !important;
        }
        #dcfmk-settings-modal #autozzal_setting_pop .jjalbang_set .scrollarea {
          max-height: 220px !important;
        }
        #dcfmk-settings-modal #autozzal_setting_pop .jjalbang_set .empty_box {
          padding: 10px 6px !important;
        }
        #dcfmk-settings-modal #headTail_lay .pop_info,
        #dcfmk-settings-modal #headTail_lay .set_cont > .inr {
          box-sizing: border-box !important;
          width: 100% !important;
        }
        #dcfmk-settings-modal #headTail_lay .set_cont > .inr {
          display: flex !important;
          min-height: 21px;
          align-items: center;
          gap: 5px;
        }
        #dcfmk-settings-modal #headTail_lay .textarea_box,
        #dcfmk-settings-modal #headTail_lay textarea {
          width: 100% !important;
        }
        #dcfmk-settings-modal #headTail_lay textarea {
          min-height: 38px !important;
          padding: 4px !important;
          line-height: 1.3 !important;
          resize: vertical;
        }
        #dcfmk-settings-modal #headTail_lay label,
        #dcfmk-settings-modal #headTail_lay h4,
        #dcfmk-settings-modal #headTail_lay p,
        #dcfmk-settings-modal #headTail_lay .tit {
          font-size: 8px !important;
          line-height: 1.25 !important;
        }
        #dcfmk-settings-modal #spoiler_set_lyr .spoiler_setting_wrap,
        #dcfmk-settings-modal #spoiler_set_lyr .inner,
        #dcfmk-settings-modal #spoiler_set_lyr .set_cont {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
        }
        #dcfmk-settings-modal #spoiler_set_lyr .set_cont {
          position: relative;
          min-height: 40px !important;
          padding: 5px 40px 5px 6px !important;
        }
        #dcfmk-settings-modal #spoiler_set_lyr .set_cont .tit,
        #dcfmk-settings-modal #spoiler_set_lyr .set_cont .txt {
          width: auto !important;
          margin: 0 !important;
        }
        #dcfmk-settings-modal #spoiler_set_lyr .set_cont .tit {
          font-size: 8px !important;
          line-height: 1.25 !important;
        }
        #dcfmk-settings-modal #spoiler_set_lyr .set_cont .txt,
        #dcfmk-settings-modal #spoiler_set_lyr .pop_info {
          font-size: 8px !important;
          line-height: 1.25 !important;
        }
        #dcfmk-settings-modal #user_block .pop_info p {
          white-space: normal !important;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text {
          display: grid !important;
          grid-template-columns: minmax(66px, 78px) minmax(0, 1fr) auto;
          align-items: center;
          gap: 4px;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text .cont_tit {
          position: static !important;
          width: auto !important;
          margin: 0 !important;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text .intxt {
          width: 100% !important;
          min-width: 0 !important;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text .btn_enroll {
          position: static !important;
          margin: 0 !important;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text .block_list {
          grid-column: 2 / -1;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .dcfmk-native-settings-nested,
        #dcfmk-settings-modal .dcfmk-native-settings-layer.dcfmk-native-settings-auxiliary {
          position: relative !important;
          inset: auto !important;
          width: 100% !important;
          max-width: 100% !important;
          height: auto !important;
          margin: 7px 0 0 !important;
          transform: none !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer.dcfmk-native-settings-auxiliary > .pop_content > .pop_head:first-child,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .dcfmk-native-settings-nested > .pop_content > .pop_head:first-child {
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
          border-bottom: 1px solid #d7d7d7 !important;
          background: #f5f5f5 !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer.dcfmk-native-settings-auxiliary > .pop_content > .pop_head:first-child :is(h3, strong),
        #dcfmk-settings-modal .dcfmk-native-settings-layer .dcfmk-native-settings-nested > .pop_content > .pop_head:first-child :is(h3, strong) {
          margin: 0 !important;
          padding: 0 !important;
          color: #444 !important;
          font: 700 9px/23px var(--dcfmk-font) !important;
          white-space: nowrap !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-auxiliary > :is(.poply_whiteclose, .poply_bgblueclose, .poply_greyclose, .poply_bgclose, .poply_close, .btn_close),
        #dcfmk-settings-modal .dcfmk-native-settings-nested > :is(.poply_whiteclose, .poply_bgblueclose, .poply_greyclose, .poply_bgclose, .poply_close, .btn_close) {
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
        #dcfmk-settings-modal .checkbox {
          position: relative !important;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        #dcfmk-settings-modal .checkbox input[type="checkbox"] {
          position: absolute !important;
          width: 1px !important;
          height: 1px !important;
          opacity: 0;
          pointer-events: none;
        }
        #dcfmk-settings-modal .checkbox .checkmark {
          position: relative !important;
          display: inline-block;
          flex: 0 0 12px;
          width: 12px !important;
          height: 12px !important;
          border: 1px solid #aaa !important;
          border-radius: 2px;
          background: #fff !important;
          background-image: none !important;
        }
        #dcfmk-settings-modal .checkbox input[type="checkbox"]:checked + .checkmark {
          border-color: var(--dcfmk-color-nav-light) !important;
          background: var(--dcfmk-color-nav-light) !important;
        }
        #dcfmk-settings-modal .checkbox input[type="checkbox"]:checked + .checkmark::after {
          position: absolute;
          top: 1px;
          left: 3px;
          width: 3px;
          height: 6px;
          border: solid #fff;
          border-width: 0 2px 2px 0;
          content: "";
          transform: rotate(45deg);
        }
        /* The native settings were compressed aggressively to fit the side panel.
           Keep the compact layout, but restore one readable size step throughout. */
        #dcfmk-settings-modal .dcfmk-settings-modal-dialog {
          grid-template-rows: 30px minmax(0, 1fr);
          font-size: 9px;
          line-height: 1.3;
        }
        #dcfmk-settings-modal .dcfmk-settings-modal-dialog > header {
          padding-right: 7px;
          padding-left: 9px;
          font-size: 11px;
        }
        #dcfmk-settings-modal .dcfmk-settings-modal-host {
          padding: 5px;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer > .pop_content,
        #dcfmk-settings-modal .dcfmk-native-settings-layer.pop_content {
          font-size: 9px !important;
          line-height: 1.3 !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer :is(button, input, textarea, select),
        #dcfmk-settings-modal .dcfmk-native-settings-layer :is(p, h4, label, li, a, .cont_tit),
        #dcfmk-settings-modal #user_block :is(button, input, label, p, h4),
        #dcfmk-settings-modal #headTail_lay :is(label, h4, p, .tit),
        #dcfmk-settings-modal #spoiler_set_lyr :is(.set_cont .tit, .set_cont .txt, .pop_info) {
          font-size: 9px !important;
          line-height: 1.3 !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer input[type="text"],
        #dcfmk-settings-modal .dcfmk-native-settings-layer select,
        #dcfmk-settings-modal .dcfmk-native-settings-layer :is(.select_box, .ul_selectric),
        #dcfmk-settings-modal .dcfmk-native-settings-layer .select_area,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .intbox,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .intbox > :is(input, button) {
          min-height: 24px !important;
          height: 24px !important;
          line-height: 22px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox button,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox button.on,
        #dcfmk-settings-modal #user_block .block_tab button {
          min-height: 25px !important;
          height: 25px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .tab_menubox button,
        #dcfmk-settings-modal #user_block .block_tab button {
          font-size: 9px !important;
          line-height: 23px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer .btn_box > button,
        #dcfmk-settings-modal #user_memo_table .btn_txtbox.copydel > button {
          min-height: 24px !important;
          height: 24px !important;
          line-height: 22px !important;
        }
        #dcfmk-settings-modal #user_memo_table .memo_list li,
        #dcfmk-settings-modal #user_memo_table .memo_list .btn-wrap,
        #dcfmk-settings-modal #user_memo_table .memo_list .btn-wrap > .btn {
          min-height: 20px !important;
          height: 20px !important;
        }
        #dcfmk-settings-modal #user_memo_table .memo_list :is(label, .nik, .mone) {
          font-size: 9px !important;
          line-height: 20px !important;
        }
        #dcfmk-settings-modal #user_memo_search {
          min-height: 24px !important;
          height: 24px !important;
        }
        #dcfmk-settings-modal #user_memo_search .array_latest,
        #dcfmk-settings-modal #user_memo_search .array_latest > .select_area {
          flex-basis: 66px;
          width: 66px !important;
          min-width: 66px !important;
          max-width: 66px !important;
        }
        #dcfmk-settings-modal #trusted_site_table .site_list li {
          min-height: 25px;
        }
        #dcfmk-settings-modal #trusted_site_table .site_list :is(p, .del) {
          font-size: 9px !important;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text {
          min-height: 39px !important;
        }
        #dcfmk-settings-modal #user_block .set_cont.add_text .intxt,
        #dcfmk-settings-modal #user_block .part_schbox .set_cont .intxt,
        #dcfmk-settings-modal #user_block .set_cont.add_text .btn_enroll,
        #dcfmk-settings-modal #user_block .part_schbox .set_cont .btn_enroll {
          height: 24px !important;
          line-height: 22px !important;
        }
        #dcfmk-settings-modal #user_block .block_list.gall li,
        #dcfmk-settings-modal #user_block .block_list.gall li > span {
          min-height: 18px !important;
          height: 18px !important;
          font-size: 9px !important;
          line-height: 18px !important;
        }
        #dcfmk-settings-modal #user_block .part_schbox .block_sch_gall li {
          min-height: 20px !important;
          font-size: 9px !important;
          line-height: 20px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer.dcfmk-native-settings-auxiliary > .pop_content > .pop_head:first-child,
        #dcfmk-settings-modal .dcfmk-native-settings-layer .dcfmk-native-settings-nested > .pop_content > .pop_head:first-child {
          min-height: 26px !important;
          height: 26px !important;
        }
        #dcfmk-settings-modal .dcfmk-native-settings-layer.dcfmk-native-settings-auxiliary > .pop_content > .pop_head:first-child :is(h3, strong),
        #dcfmk-settings-modal .dcfmk-native-settings-layer .dcfmk-native-settings-nested > .pop_content > .pop_head:first-child :is(h3, strong) {
          font-size: 10px !important;
          line-height: 25px !important;
        }
        html.dcfmk-enabled #dcfmk-sidebar .setting_list li.dcfmk-settings-trigger-active > button {
          background: #edf0fb;
          color: var(--dcfmk-color-link);
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

      listRoot.classList.add("dcfmk-list");
      listTable.classList.add("dcfmk-list-table");
      this.decorateRows();
      this.decorateTable(listTable);
      this.decorateControls();
      this.syncSubjectCells();
      this.injectStyle();
      return { listRoot, listTable };
    },

    decorateRows(root = document) {
      const currentPostNo = pageContext.pageType === "view"
        ? new URL(location.href).searchParams.get("no")
        : null;
      for (const row of DcAdapter.queryAll("table.gall_list tr.ub-content", root)) {
        if (row.dataset.dcfmkDecorated === "true") continue;

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
        row.classList.toggle("dcfmk-row-notice", rowType === "icon_notice" || numberText === "공지");
        row.classList.toggle("dcfmk-row-survey", numberText === "설문");
        row.classList.toggle("dcfmk-row-ad", numberText === "AD" || subjectText === "AD" || Boolean(row.querySelector(".icon_ad")));
        row.classList.toggle("dcfmk-current-post", Boolean(currentPostNo && rowPostNo === currentPostNo));
        row.dataset.dcfmkDecorated = "true";
      }
    },

    decorateTable(listTable) {
      const rows = Array.from(listTable.querySelectorAll("tbody tr.ub-content"));
      const headers = Array.from(listTable.querySelectorAll("thead th"));
      const headerByText = (label) => headers.find((header) => cleanText(header.textContent) === label) || null;
      const numberHeader = listTable.querySelector("thead .gall_num") || headerByText("번호");
      const subjectHeader = listTable.querySelector("thead .gall_subject") || headerByText("말머리");
      const hasSubjectColumn = rows.some((row) => row.querySelector(".gall_subject"));

      if (numberHeader) {
        numberHeader.textContent = hasSubjectColumn ? "번호" : "말머리";
        numberHeader.classList.toggle("dcfmk-hidden-number", hasSubjectColumn);
        numberHeader.classList.toggle("dcfmk-tab-cell", !hasSubjectColumn);
      }
      if (subjectHeader) {
        subjectHeader.textContent = "말머리";
        subjectHeader.classList.add("dcfmk-tab-cell");
      }
      if (hasSubjectColumn) {
        const numberColumnIndex = headers.indexOf(numberHeader);
        const numberColumn = listTable.querySelectorAll("colgroup col")[numberColumnIndex];
        numberColumn?.remove();
      }

      for (const row of rows) {
        const numberCell = row.querySelector(".gall_num");
        const subjectCell = row.querySelector(".gall_subject");
        const originalNumber = cleanText(numberCell?.textContent);
        const tabLabel = this.tabLabel(row, originalNumber, subjectCell);

        if (hasSubjectColumn) {
          numberCell?.classList.add("dcfmk-hidden-number");
          if (subjectCell) {
            subjectCell.classList.add("dcfmk-tab-cell");
            if (!cleanText(subjectCell.textContent)) subjectCell.textContent = tabLabel;
          }
        } else if (numberCell) {
          numberCell.classList.add("dcfmk-tab-cell");
          numberCell.textContent = tabLabel;
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

    tabLabel(row, numberText, subjectCell) {
      const subject = cleanText(subjectCell?.textContent);
      if (subject) return subject;
      if (row.classList.contains("dcfmk-row-notice") || numberText === "공지") return "공지";
      if (row.classList.contains("dcfmk-row-survey") || numberText === "설문") return "설문";
      if (row.classList.contains("dcfmk-row-ad") || numberText === "AD") return "AD";
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
      let join = meta.querySelector(".dcfmk-gallery-join");
      const memberSource = meta.querySelector(".dcfmk-gallery-members.membernum")
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
        join.className = "dcfmk-gallery-join";
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
      const existing = document.querySelector(".dcfmk-gallery-intro");
      if (existing) {
        const text = existing.querySelector(".dcfmk-gallery-intro-text");
        if (pageHead.parentElement !== existing) existing.insertBefore(pageHead, text || null);
        pageHead.classList.add("dcfmk-gallery-intro-title");
        this.mountMiniMemberControl(existing.querySelector(".dcfmk-gallery-meta"));
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
      intro.className = "dcfmk-gallery-intro";
      intro.setAttribute("aria-label", "갤러리 소개");
      const anchorParent = pageHead.parentNode;
      const anchorNext = pageHead.nextSibling;
      let galleryCover = null;

      if (coverSource && this.shouldShowGalleryCover()) {
        const imageContainer = document.createElement("div");
        imageContainer.className = "dcfmk-gallery-cover";
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

      pageHead.classList.add("dcfmk-gallery-intro-title");
      intro.appendChild(pageHead);

      const text = document.createElement("div");
      text.className = "dcfmk-gallery-intro-text";
      if (rankLabel || rankNumber || memberLabel || memberNumber || hasMemberControl) {
        const meta = document.createElement("div");
        meta.className = "dcfmk-gallery-meta";
        if (rankLabel || rankNumber) {
          const rank = document.createElement("span");
          rank.className = "dcfmk-gallery-rank";
          const icon = rankIconSource?.cloneNode(false) || document.createElement("span");
          icon.classList.add("dcfmk-gallery-rank-icon");
          icon.setAttribute("aria-hidden", "true");
          if (!rankIconSource) {
            icon.classList.add("dcfmk-gallery-rank-icon-fallback");
            icon.textContent = "●";
          }
          const value = document.createElement("strong");
          value.textContent = [rankLabel, rankNumber].filter(Boolean).join(" ");
          rank.append(icon, value);
          meta.appendChild(rank);
        }
        if (memberLabel || memberNumber) {
          if (memberSource) {
            memberSource.classList.add("dcfmk-gallery-members");
            meta.appendChild(memberSource);
          } else {
            const member = document.createElement("span");
            member.className = "dcfmk-gallery-members";
            member.innerHTML = '<span class="dcfmk-gallery-members-icon" aria-hidden="true"></span>';
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
        popupClass: "dcfmk-relation-popup",
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

      const galleryIntro = pageHead.closest(".dcfmk-gallery-intro");
      const existing = document.querySelector(".dcfmk-manager-line");
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

      const introText = galleryIntro?.querySelector(".dcfmk-gallery-intro-text");
      if (openingDate && introText && !introText.querySelector(".dcfmk-opening-date")) {
        const date = document.createElement("span");
        date.className = "dcfmk-opening-date";
        date.innerHTML = "<strong>개설일:</strong> ";
        date.append(document.createTextNode(openingDate));
        introText.appendChild(date);
      }

      const line = document.createElement("div");
      line.className = "dcfmk-manager-line";
      line.title = [
        managers.length ? `매니저: ${managers.join(", ")}` : "",
        subManagers.length ? `부매니저: ${subManagers.join(", ")}` : "",
        openingDate ? `개설일: ${openingDate}` : "",
      ].filter(Boolean).join(" · ");

      const appendGroup = (label, names, className = "") => {
        if (names.length === 0) return null;
        const group = document.createElement("div");
        group.className = "dcfmk-manager-group";
        if (className) group.classList.add(className);
        group.dataset.managerLabel = label;
        const heading = document.createElement("strong");
        heading.textContent = `${label}:`;
        const value = document.createElement("span");
        value.className = "dcfmk-manager-value";
        value.textContent = names.join(", ");
        group.append(heading, value);
        line.appendChild(group);
        return { group, value };
      };
      appendGroup("매니저", managers);

      const subManagerGroup = appendGroup("부매니저", subManagers.slice(0, 2), "dcfmk-submanager-group");
      if (subManagerGroup && subManagers.length > 2) {
        const extraRow = document.createElement("div");
        extraRow.className = "dcfmk-submanager-extra-row";
        extraRow.hidden = true;
        const extraNames = document.createElement("span");
        extraNames.className = "dcfmk-submanager-extra";
        extraNames.textContent = subManagers.slice(2).join(", ");
        extraRow.appendChild(extraNames);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "dcfmk-submanager-toggle";
        toggle.setAttribute("aria-label", `부매니저 ${subManagers.length - 2}명 더 보기`);
        toggle.setAttribute("aria-expanded", "false");
        toggle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="m3 6 5 5 5-5Z"></path></svg>';
        subManagerGroup.group.append(toggle, extraRow);
      }

      if (openingDate && !introText) {
        appendGroup("개설일", [openingDate], "dcfmk-opening-date-group");
      }

      if (reportButton) {
        const reportRow = document.createElement("div");
        reportRow.className = "dcfmk-manager-report-row";
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
            anchor: () => reportButton.closest(".dcfmk-manager-line") || reportButton,
            popupClass: "dcfmk-manager-report-popup",
            nativeFunction: "get_manage_report",
            closeSelector: ".poply_whiteclose",
          });
        }
      }

      line.addEventListener("click", (event) => {
        const toggle = event.target.closest?.(".dcfmk-submanager-toggle");
        if (toggle && line.contains(toggle)) {
          event.preventDefault();
          const extraRow = toggle.closest(".dcfmk-submanager-group")?.querySelector(".dcfmk-submanager-extra-row");
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
      link.className = `dcfmk-board-tab ${className}`.trim();
      link.href = href;
      link.textContent = label;
      if (active) {
        link.classList.add("dcfmk-active");
        link.setAttribute("aria-current", "page");
      }
      return link;
    },

    layoutBoardNavigation(nav) {
      const more = nav?.querySelector(":scope > .dcfmk-board-more");
      const menu = nav?.querySelector(":scope > .dcfmk-board-more-menu");
      if (!nav || !more || !menu) return;

      const listTabs = nav.closest(".list_array_option");
      listTabs?.style.removeProperty("width");
      nav.style.removeProperty("flex");
      nav.style.removeProperty("width");

      const wasOpen = more.classList.contains("dcfmk-open");
      const movable = Array.from(nav.querySelectorAll(".dcfmk-board-tab[data-overflow-order]"))
        .sort((left, right) => Number(left.dataset.overflowOrder) - Number(right.dataset.overflowOrder));
      for (const link of movable) nav.insertBefore(link, more);
      const firstHead = movable[0];
      if (firstHead) {
        const navBox = nav.getBoundingClientRect();
        const firstHeadBox = firstHead.getBoundingClientRect();
        const navBorderLeft = Number.parseFloat(getComputedStyle(nav).borderLeftWidth) || 0;
        menu.style.setProperty(
          "--dcfmk-board-menu-start",
          `${Math.max(0, firstHeadBox.left - navBox.left - navBorderLeft)}px`,
        );
      }
      more.hidden = true;
      more.classList.remove("dcfmk-active");

      const firstRowOverflows = () => {
        const navTop = nav.getBoundingClientRect().top;
        const rowItems = Array.from(nav.children)
          .filter((child) => child !== menu && !child.hidden);
        return nav.scrollWidth > nav.clientWidth + 1
          || rowItems.some((item) => item.getBoundingClientRect().top > navTop + 2);
      };

      if (!firstRowOverflows()) {
        more.classList.remove("dcfmk-open");
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
      more.classList.toggle("dcfmk-active", Boolean(menu.querySelector(".dcfmk-active")));
      more.classList.toggle("dcfmk-open", wasOpen);
      more.querySelector("button")?.setAttribute("aria-expanded", String(wasOpen));
    },

    bindBoardMore(nav, more) {
      const button = more.querySelector("button");
      const close = () => {
        more.classList.remove("dcfmk-open");
        button?.setAttribute("aria-expanded", "false");
      };
      button?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (more.hidden) {
          close();
          return;
        }
        const open = more.classList.toggle("dcfmk-open");
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
        nav.__dcfmkResizeObserver = observer;
      }
    },

    mountBoardNavigation(listTabs) {
      if (!listTabs) return;
      const mountedNav = listTabs.querySelector(".dcfmk-board-nav");
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
      nav.className = "dcfmk-board-nav";
      nav.setAttribute("aria-label", "갤러리 글 분류");

      const home = this.boardTab(
        "전체글",
        pageContext.urls.list,
        !exceptionMode && searchHead === null,
        "dcfmk-board-tab-home",
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
          "dcfmk-board-tab-concept",
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
      more.className = "dcfmk-board-more";
      more.hidden = true;
      more.innerHTML = `
        <button type="button" class="dcfmk-board-more-button" aria-label="말머리 더보기" aria-expanded="false">
          <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="m3 6 5 5 5-5Z"></path></svg>
        </button>
      `;
      nav.appendChild(more);
      const moreMenu = document.createElement("div");
      moreMenu.className = "dcfmk-board-more-menu";
      moreMenu.setAttribute("role", "menu");
      nav.appendChild(moreMenu);
      listTabs.prepend(nav);
      originalTabs?.classList.add("dcfmk-board-nav-source");
      originalHeads?.classList.add("dcfmk-board-nav-source");
      this.syncSubjectCells(nav);
      this.bindBoardMore(nav, more);
    },

    subjectTargets(root = document, nav = root.querySelector?.(".dcfmk-board-nav")) {
      const targets = new Map();
      for (const link of nav?.querySelectorAll(".dcfmk-board-tab") || []) {
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
      return `dcfmk:subject-targets:${pageContext.galleryKey}`;
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
      for (const cell of document.querySelectorAll("table.dcfmk-list-table tbody tr.ub-content .dcfmk-tab-cell")) {
        if (cell.querySelector(":scope > .dcfmk-subject-filter-link")) continue;
        const label = cleanText(cell.textContent);
        const targetHref = targets.get(label);
        if (!targetHref) continue;

        const link = document.createElement("a");
        link.className = "dcfmk-subject-filter-link";
        link.href = targetHref;
        link.setAttribute("aria-label", `${label} 말머리 글만 보기`);
        while (cell.firstChild) link.appendChild(cell.firstChild);
        cell.appendChild(link);
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
        "table.dcfmk-list-table tbody tr.ub-content .dcfmk-tab-cell:not(:has(> .dcfmk-subject-filter-link))",
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
      const galleryCover = document.querySelector(".dcfmk-gallery-cover");
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
      if (document.documentElement.dataset.dcfmkHeaderWatch === "true") return;
      document.documentElement.dataset.dcfmkHeaderWatch = "true";

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
      const existing = listArticle.querySelector(":scope > .dcfmk-fm-bottom-menu");
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
      menu.className = "dcfmk-fm-bottom-menu";
      if (searchForm) {
        const searchWrap = searchForm.querySelector(".buttom_search_wrap");
        const searchInput = searchWrap?.querySelector(".bottom_search");
        const searchType = searchWrap?.querySelector(".bottom_array");
        const searchTypeArea = searchType?.querySelector(".select_area");
        searchInput?.classList.add("dcfmk-control-frame");
        searchTypeArea?.classList.add("dcfmk-control-frame");
        searchTypeArea?.querySelector(":scope > .inner")?.classList.add("dcfmk-control-addon");
        if (searchWrap && searchInput && searchType) searchWrap.append(searchInput, searchType);
        menu.appendChild(searchForm);
      }
      const actions = document.createElement("div");
      actions.className = "dcfmk-fm-bottom-actions";
      if (conceptButton) {
        let conceptControl = conceptButton;
        if (conceptActive) {
          conceptControl = document.createElement("a");
          conceptControl.href = pageContext.urls.list;
          conceptControl.className = "dcfmk-fm-bottom-button dcfmk-fm-concept-button dcfmk-active";
          conceptControl.textContent = "개념글";
          conceptControl.dataset.dcfmkToggleUrl = pageContext.urls.list;
          conceptControl.setAttribute("aria-current", "page");
          conceptControl.setAttribute("aria-label", "개념글, 전체글 목록으로 돌아가기");
        } else {
          conceptControl.classList.add("dcfmk-fm-bottom-button", "dcfmk-fm-concept-button");
          conceptButton.setAttribute("aria-pressed", "false");
          conceptButton.setAttribute("aria-label", "개념글 보기");
        }
        actions.appendChild(conceptControl);
      }
      if (writeButton) {
        writeButton.classList.add("dcfmk-fm-bottom-button", "dcfmk-fm-write-button");
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

      control.classList.add("dcfmk-list-size-control");
      control.closest(".right_box")?.querySelector(".switch_btnbox .btn_write")
        ?.classList.add("dcfmk-top-write-button");
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

      if (!control.dataset.dcfmkListSizePreferenceBound) {
        control.dataset.dcfmkListSizePreferenceBound = "true";
        control.addEventListener("click", (event) => {
          const option = event.target.closest?.("#listSizeLayer a");
          if (!option || !control.contains(option)) return;
          const size = cleanText(option.textContent).match(/(?:30|50|100)/)?.[0];
          if (size) ListSizeConfig.set(size);
        }, true);
      }
    },

    alignSidebarToList() {
      const sidebar = document.getElementById("dcfmk-sidebar");
      if (!sidebar) return;
      sidebar.style.marginTop = "0px";
    },

    injectStyle() {
      if (document.getElementById("dcfmk-list-style")) return;

      const style = document.createElement("style");
      style.id = "dcfmk-list-style";
      style.textContent = `
        html.dcfmk-enabled .list_array_option {
          display: flex !important;
          align-items: flex-end;
          justify-content: space-between;
          min-height: 38px;
          margin-top: 12px;
          border-bottom: 0;
        }
        html.dcfmk-enabled .list_array_option::after {
          display: none !important;
        }
        html.dcfmk-enabled .array_tab {
          display: inline-flex;
          flex: 0 0 auto;
          align-items: flex-end;
          gap: 2px;
          width: auto !important;
          height: 38px;
        }
        html.dcfmk-enabled .array_tab button {
          min-width: 76px;
          height: 34px;
          border: 1px solid var(--dcfmk-color-border);
          border-bottom: 0;
          border-radius: 0;
          background: #fff;
          color: #555;
          font-size: 12px;
          font-weight: 700;
        }
        html.dcfmk-enabled .array_tab button:hover {
          border-color: #aebbd7;
          color: var(--dcfmk-color-link);
        }
        html.dcfmk-enabled .array_tab button.on {
          border-color: var(--dcfmk-color-nav-light);
          background: var(--dcfmk-color-nav-light);
          color: #fff;
        }
        html.dcfmk-enabled .list_array_option .right_box {
          float: none;
          width: auto;
          padding-top: 4px;
        }
        html.dcfmk-enabled .list_array_option .output_array {
          display: flex !important;
          align-items: center;
          gap: 6px;
          padding-top: 0;
        }
        html.dcfmk-enabled .list_array_option .select_area,
        html.dcfmk-enabled .list_array_option .btn_write {
          height: 29px;
          border: 1px solid var(--dcfmk-color-border);
          border-radius: 0;
          background: #fff;
          color: #555;
          line-height: 27px;
        }
        html.dcfmk-enabled .list_array_option .btn_write {
          display: inline-block;
          min-width: 64px;
          padding: 0 10px;
          border-color: var(--dcfmk-color-nav-light);
          background: var(--dcfmk-color-nav-light);
          color: #fff;
          font-weight: 700;
          text-align: center;
        }
        html.dcfmk-enabled .dcfmk-list {
          border-top: 2px solid var(--dcfmk-color-nav-light);
        }
        html.dcfmk-enabled table.dcfmk-list-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          color: var(--dcfmk-color-text);
          font-family: var(--dcfmk-font);
        }
        html.dcfmk-enabled table.dcfmk-list-table thead th {
          height: 34px;
          border-bottom: 1px solid #cfd5df;
          background: var(--dcfmk-color-subtle);
          color: #555;
          font-size: 11px;
          font-weight: 700;
          text-align: center;
        }
        html.dcfmk-enabled table.dcfmk-list-table tbody tr {
          transition: background-color 100ms ease;
        }
        html.dcfmk-enabled table.dcfmk-list-table tbody tr:hover {
          background: #f3f7ff;
        }
        html.dcfmk-enabled table.dcfmk-list-table tbody td {
          height: 34px;
          padding-top: 0;
          padding-bottom: 0;
          border-bottom: 1px solid #e7e7e7;
          color: var(--dcfmk-color-text);
          font-size: 12px;
          line-height: 34px;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_num,
        html.dcfmk-enabled table.dcfmk-list-table .gall_date,
        html.dcfmk-enabled table.dcfmk-list-table .gall_count,
        html.dcfmk-enabled table.dcfmk-list-table .gall_recommend {
          color: var(--dcfmk-color-muted);
          font-size: 11px;
          text-align: center;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_tit {
          padding-left: 8px;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_tit > a:not(.reply_numbox) {
          color: #222;
          text-decoration: none;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_tit > a:not(.reply_numbox):visited {
          color: #999;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_tit > a:not(.reply_numbox):hover {
          color: var(--dcfmk-color-link);
          text-decoration: underline;
        }
        html.dcfmk-enabled table.dcfmk-list-table .reply_numbox,
        html.dcfmk-enabled table.dcfmk-list-table .reply_num {
          color: var(--dcfmk-color-link);
          font-size: 11px;
          font-weight: 400;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_writer {
          overflow: visible;
          padding: 0 6px;
          text-align: left;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcfmk-enabled table.dcfmk-list-table tr.dcfmk-row-notice {
          background: #fafafa;
        }
        html.dcfmk-enabled table.dcfmk-list-table tr.dcfmk-row-notice .gall_num,
        html.dcfmk-enabled table.dcfmk-list-table tr.dcfmk-row-notice .gall_tit > a {
          color: var(--dcfmk-color-link);
          font-weight: 700;
        }
        html.dcfmk-enabled table.dcfmk-list-table tr.dcfmk-row-survey {
          background: #f7f9fd;
        }
        html.dcfmk-enabled table.dcfmk-list-table tr.dcfmk-row-ad {
          background: #fffdf7;
        }
        html.dcfmk-enabled .list_bottom_btnbox {
          min-height: 42px;
          padding-top: 10px;
        }
        html.dcfmk-enabled .list_bottom_btnbox button {
          height: 30px;
          border: 1px solid var(--dcfmk-color-border);
          border-radius: 0;
          background: #fff;
          color: #555;
          line-height: 28px;
        }
        html.dcfmk-enabled .list_bottom_btnbox .btn_blue,
        html.dcfmk-enabled .list_bottom_btnbox #btn_write {
          border-color: var(--dcfmk-color-nav-light);
          background: var(--dcfmk-color-nav-light);
          color: #fff;
        }
        html.dcfmk-enabled .bottom_paging_wrap {
          display: flex !important;
          align-items: flex-start;
          justify-content: center;
          gap: 10px;
          min-height: 48px;
          margin-top: 4px;
          padding: 9px 10px 0;
          border-top: 1px solid var(--dcfmk-color-border);
        }
        html.dcfmk-enabled .bottom_paging_wrap::after {
          display: none !important;
        }
        html.dcfmk-enabled .bottom_paging_box {
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
        html.dcfmk-enabled .bottom_paging_box > a,
        html.dcfmk-enabled .bottom_paging_box > em {
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
          color: #555;
          font-style: normal;
          line-height: 25px;
          text-decoration: none;
        }
        html.dcfmk-enabled .bottom_paging_box > a:hover {
          border-color: var(--dcfmk-color-border);
          color: var(--dcfmk-color-link);
        }
        html.dcfmk-enabled .bottom_paging_box > em {
          border-color: var(--dcfmk-color-nav-light);
          background: var(--dcfmk-color-nav-light);
          color: #fff;
          font-weight: 700;
        }
        html.dcfmk-enabled .bottom_paging_box .page_next,
        html.dcfmk-enabled .bottom_paging_box .page_end {
          width: 42px;
          min-width: 42px;
          overflow: visible;
          background-image: none !important;
          font-size: 11px !important;
          text-indent: 0 !important;
        }
        html.dcfmk-enabled .bottom_movebox {
          position: static;
          flex: 0 0 auto;
          width: auto;
          margin: 0;
        }
        html.dcfmk-enabled .buttom_search_wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100% !important;
          height: 32px;
          margin: 14px 0 28px;
        }
        html.dcfmk-enabled .buttom_search_wrap .bottom_array {
          float: none;
          width: 125px;
          height: 32px;
        }
        html.dcfmk-enabled .buttom_search_wrap .select_area {
          height: 32px;
          margin: 0 !important;
          border: 1px solid var(--dcfmk-color-border);
          border-radius: 0;
          background: #fff;
          color: #555;
          line-height: 30px;
        }
        html.dcfmk-enabled .buttom_search_wrap .bottom_search {
          position: static !important;
          float: none;
          width: 320px;
          height: 32px;
          margin: 0 0 0 5px !important;
          border: 1px solid var(--dcfmk-color-nav-light);
          background: #fff;
        }
        html.dcfmk-enabled .buttom_search_wrap .bottom_search .inner_search {
          float: left;
          width: 281px;
          height: 30px;
          margin: 0 !important;
        }
        html.dcfmk-enabled .buttom_search_wrap .bottom_search .in_keyword {
          width: 281px;
          height: 30px;
        }
        html.dcfmk-enabled .buttom_search_wrap .bottom_search .bnt_search {
          float: right;
          width: 37px;
          height: 30px;
          margin: 0 !important;
          background-color: var(--dcfmk-color-nav-light);
        }
        html.dcfmk-enabled .page_head {
          position: relative;
          min-height: 42px;
          margin-bottom: 0;
          border-bottom: 0;
        }
        html.dcfmk-enabled .page_head h2 {
          position: relative;
          margin: 4px 0 0;
          padding: 0 0 0 24px;
          font-size: 20px;
          line-height: 26px;
        }
        html.dcfmk-enabled .page_head h2::before {
          position: absolute;
          top: 0;
          left: 0;
          width: 14px;
          height: 26px;
          border-radius: 2px;
          background: #444;
          content: "";
        }
        html.dcfmk-enabled .page_head h2 a {
          color: #555;
          font-size: 20px;
          line-height: 26px;
          text-decoration: none;
        }
        html.dcfmk-enabled .page_head .pagehead_titicon {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro > .page_head > .fl {
          display: flex;
          float: none;
          min-width: 0;
          flex: 1 1 auto;
          align-items: center;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro > .page_head h2 {
          float: none !important;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro > .page_head .favorite {
          display: inline-flex !important;
          float: none !important;
          align-items: center;
          margin: 3px 0 0 8px !important;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro > .page_head .favorite button {
          display: inline-flex;
          width: 28px !important;
          height: 29px !important;
          align-items: center;
          justify-content: center;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro > .page_head .favorite button .icon_favorite {
          margin: 0 !important;
          transform: scale(1.2);
          transform-origin: center;
        }
        html.dcfmk-enabled .page_head .gall_issuebox .issue_gallinfo,
        html.dcfmk-enabled .page_head .gall_issuebox > .bundle {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro > .page_head .gall_issuebox {
          display: flex !important;
          float: none !important;
          flex: 0 0 auto;
          align-items: center;
          margin-left: 10px;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro > .page_head .gall_issuebox .relate {
          display: inline-flex !important;
          height: 24px;
          align-items: center;
          border: 0;
          padding: 0;
          background: transparent;
          color: #666;
          font: 11px/24px var(--dcfmk-font);
          cursor: pointer;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro > .page_head .gall_issuebox .relate:hover {
          color: var(--dcfmk-color-link);
          text-decoration: underline;
        }
        html.dcfmk-enabled .page_head .adr_copy,
        html.dcfmk-enabled .page_head .gall_useinfo {
          display: none !important;
        }
        html.dcfmk-enabled .issue_contentbox,
        html.dcfmk-enabled .minor_intro_box,
        html.dcfmk-enabled .mini_intro_box,
        html.dcfmk-enabled .person_intro_box {
          display: none !important;
        }
        html.dcfmk-enabled .issue_wrap {
          border-top: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro {
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
          color: #555;
        }
        html.dcfmk-enabled .dcfmk-gallery-cover {
          position: relative;
          z-index: 1;
          display: flex;
          width: fit-content;
          max-width: 100%;
          align-items: center;
          justify-content: center;
          margin: -4px auto 9px;
          background: #fff;
        }
        html.dcfmk-enabled.dcfmk-gallery-cover-hidden .dcfmk-gallery-cover {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-gallery-cover > img {
          display: block;
          width: auto;
          max-width: 100%;
          height: auto;
          max-height: 450px;
          object-fit: contain;
        }
        html.dcfmk-enabled .dcfmk-gallery-cover > span {
          display: block;
          width: 100%;
          aspect-ratio: 16 / 9;
          max-height: 450px;
          background-position: center;
          background-repeat: no-repeat;
          background-size: contain;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro-text {
          display: flex;
          box-sizing: border-box;
          width: min(800px, 100%);
          min-width: 0;
          align-items: center;
          flex-direction: row;
          gap: 10px;
          padding: 0 2px;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro > .page_head {
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
        html.dcfmk-enabled .dcfmk-gallery-intro > .page_head h2 {
          margin-top: 2px;
        }
        html.dcfmk-enabled .dcfmk-gallery-meta {
          display: flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 12px;
          min-height: 16px;
        }
        html.dcfmk-enabled .dcfmk-gallery-rank,
        html.dcfmk-enabled .dcfmk-gallery-members {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: var(--dcfmk-color-nav);
          font-size: 12px;
        }
        html.dcfmk-enabled .dcfmk-gallery-rank-icon {
          display: inline-block;
          flex: 0 0 auto;
          float: none !important;
          margin: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-gallery-rank-icon-fallback {
          color: #e64b45;
          font-size: 9px;
        }
        html.dcfmk-enabled .dcfmk-gallery-rank strong,
        html.dcfmk-enabled .dcfmk-gallery-members strong {
          font-weight: 700;
        }
        html.dcfmk-enabled .dcfmk-gallery-members {
          float: none !important;
          margin: 0 !important;
          color: #666;
        }
        html.dcfmk-enabled .dcfmk-gallery-join {
          position: relative;
          display: inline-flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 6px;
        }
        html.dcfmk-enabled .dcfmk-gallery-join > .box {
          display: inline-flex;
          float: none !important;
          align-items: center;
          margin: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-gallery-join .smallestgag {
          float: none !important;
          margin: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-gallery-join > .txt.font_grey {
          display: inline-flex;
          align-items: center;
          margin: 0;
          font-size: 12px;
          white-space: nowrap;
        }
        html.dcfmk-enabled .dcfmk-gallery-members-icon {
          position: relative;
          display: inline-block;
          width: 12px;
          height: 12px;
        }
        html.dcfmk-enabled .dcfmk-gallery-members-icon::before {
          position: absolute;
          top: 0;
          left: 4px;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #777;
          content: "";
        }
        html.dcfmk-enabled .dcfmk-gallery-members-icon::after {
          position: absolute;
          bottom: 0;
          left: 2px;
          width: 9px;
          height: 6px;
          border-radius: 5px 5px 2px 2px;
          background: #777;
          content: "";
        }
        html.dcfmk-enabled .dcfmk-gallery-intro-text p {
          flex: 1 1 auto;
          min-width: 0;
          margin: 0;
          overflow: hidden;
          color: #555;
          font-size: 12px;
          line-height: 18px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcfmk-enabled .dcfmk-opening-date {
          flex: 0 0 auto;
          margin-left: auto;
          color: #777;
          font-size: 11px;
          line-height: 18px;
          white-space: nowrap;
        }
        html.dcfmk-enabled .dcfmk-opening-date strong {
          color: #666;
          font-weight: 400;
        }
        html.dcfmk-enabled .dcfmk-manager-line {
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
          color: #777;
          font-size: 11px;
          line-height: 17px;
          align-items: flex-start;
          gap: 14px;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro + .dcfmk-manager-line {
          margin-top: 0;
        }
        html.dcfmk-enabled .dcfmk-gallery-intro > .dcfmk-manager-line {
          width: min(800px, 100%);
          min-height: 17px;
          margin: 0;
          padding: 0 2px 2px;
        }
        html.dcfmk-enabled .dcfmk-manager-group {
          display: flex;
          min-width: 0;
          align-items: flex-start;
        }
        html.dcfmk-enabled .dcfmk-submanager-group {
          display: grid;
          flex: 1 1 0;
          grid-template-columns: max-content max-content 17px minmax(0, 1fr);
          grid-template-rows: 17px auto;
          align-items: start;
          justify-content: start;
        }
        html.dcfmk-enabled .dcfmk-manager-group:not(.dcfmk-submanager-group) {
          flex: 0 0 auto;
        }
        html.dcfmk-enabled .dcfmk-manager-group:not(.dcfmk-submanager-group) .dcfmk-manager-value {
          white-space: nowrap;
        }
        html.dcfmk-enabled .dcfmk-manager-group strong {
          display: block !important;
          flex: 0 0 auto;
          width: auto !important;
          margin-right: 4px;
          color: #666;
          font-weight: 400;
          white-space: nowrap !important;
        }
        html.dcfmk-enabled .dcfmk-manager-value {
          display: inline;
          min-width: 0;
          color: var(--dcfmk-color-link);
          white-space: normal;
        }
        html.dcfmk-enabled .dcfmk-manager-value[hidden] {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-submanager-toggle,
        html.dcfmk-enabled .dcfmk-manager-report-row .btn_mngadmin_report {
          display: inline-block;
          width: auto;
          height: 17px;
          margin: 0;
          padding: 0;
          border: 0;
          background: transparent;
          color: var(--dcfmk-color-link) !important;
          font: 11px/17px var(--dcfmk-font);
          vertical-align: top;
          cursor: pointer;
        }
        html.dcfmk-enabled .dcfmk-submanager-toggle {
          grid-column: 3;
          grid-row: 1;
          width: 17px;
          margin-left: 3px;
          white-space: nowrap;
        }
        html.dcfmk-enabled .dcfmk-submanager-toggle svg {
          display: block;
          width: 12px;
          height: 12px;
          margin: 2px auto;
          fill: currentColor;
          transition: transform 0.15s ease;
        }
        html.dcfmk-enabled .dcfmk-submanager-toggle[aria-expanded="true"] svg {
          transform: rotate(180deg);
        }
        html.dcfmk-enabled .dcfmk-submanager-extra-row {
          grid-column: 2 / -1;
          grid-row: 2;
          min-width: 0;
          padding-top: 1px;
          color: var(--dcfmk-color-link);
          line-height: 17px;
          overflow-wrap: anywhere;
        }
        html.dcfmk-enabled .dcfmk-submanager-extra-row[hidden] {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-manager-report-row {
          flex: 0 0 auto;
          min-height: 17px;
          margin-left: auto;
          padding: 0;
        }
        html.dcfmk-enabled .dcfmk-manager-report-row .btn_mngadmin_report:hover,
        html.dcfmk-enabled .dcfmk-submanager-toggle:hover {
          text-decoration: underline;
        }
        html.dcfmk-enabled .dcfmk-manager-report-row .btn_mngadmin_report[aria-busy="true"],
        html.dcfmk-enabled .dcfmk-gallery-intro .gall_issuebox .relate[aria-busy="true"] {
          opacity: 0.55;
          cursor: progress;
        }
        html.dcfmk-enabled #container > .left_content {
          position: relative;
        }
        html.dcfmk-enabled.dcfmk-relation-popup-opening #relation_popup:not(.dcfmk-anchored-popup) {
          visibility: hidden !important;
        }
        html.dcfmk-enabled #container > .left_content > .dcfmk-anchored-popup {
          position: absolute !important;
          top: var(--dcfmk-anchored-popup-top, 0) !important;
          right: var(--dcfmk-anchored-popup-right, 0) !important;
          bottom: auto !important;
          left: auto !important;
          z-index: 10020 !important;
          box-sizing: border-box;
          max-width: 100% !important;
          max-height: none !important;
          margin: 0 !important;
          transform: none !important;
        }
        html.dcfmk-enabled .list_array_option {
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
        html.dcfmk-enabled .list_array_option::before {
          display: none;
          content: none;
        }
        html.dcfmk-enabled .list_array_option .dcfmk-board-nav-source {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-board-nav {
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
          border: 1px solid #ddd;
          border-radius: 2px;
          background: #fff;
          box-shadow: 0 1px 1px rgb(0 0 0 / 8%);
          overflow: visible;
        }
        html.dcfmk-enabled .dcfmk-board-tab {
          display: inline-flex;
          flex: 0 0 auto;
          min-width: 0;
          height: 35px;
          align-items: center;
          justify-content: center;
          margin: 0;
          padding: 0 12px;
          border: 0;
          border-right: 1px solid #e5e5e5;
          border-radius: 0;
          background: transparent;
          color: #777;
          font-size: 11px;
          font-weight: 700;
          line-height: 35px;
          text-decoration: none;
        }
        html.dcfmk-enabled .dcfmk-board-tab:hover {
          border-color: #e5e5e5;
          background: #f9f9f9;
          color: var(--dcfmk-color-link);
        }
        html.dcfmk-enabled .dcfmk-board-tab.dcfmk-active {
          margin: 0;
          background: #eef0f8;
          color: var(--dcfmk-color-nav);
          box-shadow: none;
        }
        html.dcfmk-enabled .dcfmk-board-tab-home,
        html.dcfmk-enabled .dcfmk-board-tab-concept {
          background: #eef0f8;
          color: var(--dcfmk-color-nav);
        }
        html.dcfmk-enabled .dcfmk-board-tab-concept.dcfmk-active {
          color: #3262c5;
        }
        html.dcfmk-enabled .dcfmk-board-tab-home {
          min-width: 38px;
          width: 38px;
          padding: 0;
        }
        html.dcfmk-enabled .dcfmk-board-tab-home svg {
          width: 14px;
          height: 14px;
          fill: currentColor;
        }
        html.dcfmk-enabled .dcfmk-board-more {
          position: relative;
          display: flex;
          flex: 0 0 33px;
          width: 33px;
          height: 35px;
          margin-left: 0;
        }
        html.dcfmk-enabled .dcfmk-board-more[hidden] {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-board-more-button {
          display: inline-flex;
          width: 33px;
          height: 35px;
          align-items: center;
          justify-content: center;
          padding: 0;
          border: 0;
          border-left: 1px solid #e5e5e5;
          background: #fafafa;
          color: #666;
          cursor: pointer;
        }
        html.dcfmk-enabled .dcfmk-board-more-button:hover,
        html.dcfmk-enabled .dcfmk-board-more.dcfmk-active .dcfmk-board-more-button,
        html.dcfmk-enabled .dcfmk-board-more.dcfmk-open .dcfmk-board-more-button {
          background: #eef0f8;
          color: var(--dcfmk-color-nav);
        }
        html.dcfmk-enabled .dcfmk-board-more-button svg {
          width: 13px;
          height: 13px;
          fill: currentColor;
          transition: transform 120ms ease;
        }
        html.dcfmk-enabled .dcfmk-board-more.dcfmk-open .dcfmk-board-more-button svg {
          transform: rotate(180deg);
        }
        html.dcfmk-enabled .dcfmk-board-more-menu {
          position: absolute;
          z-index: 6;
          top: calc(100% + 1px);
          left: 0;
          display: none;
          box-sizing: border-box;
          width: 100%;
          min-height: 29px;
          padding: 4px 38px 4px var(--dcfmk-board-menu-start, 0px);
          flex-wrap: wrap;
          align-items: center;
          border: 1px solid #d8dbe5;
          border-radius: 0 0 2px 2px;
          background: #fafafa;
          box-shadow: inset 0 1px 0 #fff;
        }
        html.dcfmk-enabled .dcfmk-board-more.dcfmk-open + .dcfmk-board-more-menu {
          display: flex;
        }
        html.dcfmk-enabled .dcfmk-board-more[hidden] + .dcfmk-board-more-menu {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-board-more-menu .dcfmk-board-tab {
          height: 29px;
          padding: 0 12px;
          border-right: 1px solid #e2e2e2;
          line-height: 29px;
          white-space: nowrap;
        }
        html.dcfmk-enabled .list_array_option .right_box {
          position: relative;
          z-index: 4;
          display: flex !important;
          box-sizing: border-box !important;
          flex: 0 0 151px !important;
          min-width: 151px !important;
          max-width: 151px !important;
          width: 151px !important;
          height: 37px;
          align-self: flex-start;
          margin: 0 0 0 auto !important;
          padding: 0 !important;
          border: 1px solid #ddd;
          border-radius: 2px;
          background: #fafafa;
          box-shadow: 0 1px 1px rgb(0 0 0 / 8%);
        }
        html.dcfmk-enabled .list_array_option .right_box .output_array {
          display: flex !important;
          box-sizing: border-box;
          width: 100%;
          height: 35px;
          align-items: center;
          gap: 5px;
          margin: 0;
          padding: 0 4px 0 5px;
        }
        html.dcfmk-enabled .list_array_option .right_box .switch_btnbox {
          display: flex !important;
          flex: 0 0 auto;
          width: auto;
          height: 35px;
          align-items: center;
          margin: 0;
          padding: 0;
          font-size: 0;
        }
        html.dcfmk-enabled .list_array_option .dcfmk-list-size-control {
          position: relative;
          float: none !important;
          box-sizing: border-box;
          width: 61px !important;
          height: 35px;
          margin: 0 !important;
        }
        html.dcfmk-enabled .list_array_option .dcfmk-list-size-control > select {
          display: none !important;
        }
        html.dcfmk-enabled .list_array_option .dcfmk-list-size-control > .select_area {
          display: block !important;
          box-sizing: border-box;
          width: 61px !important;
          height: 35px !important;
          margin: 0 !important;
          border: 0;
          background: transparent;
        }
        html.dcfmk-enabled .list_array_option .dcfmk-list-size-control > .select_area > a {
          position: relative;
          display: block;
          box-sizing: border-box;
          width: 61px;
          height: 35px;
          overflow: hidden;
          padding: 0 20px 0 9px;
          color: #666;
          font: 700 10px/35px var(--dcfmk-font);
          text-align: left;
          text-decoration: none;
          white-space: nowrap;
        }
        html.dcfmk-enabled .list_array_option .dcfmk-list-size-control > .select_area > a:hover {
          background: #eef0f8;
          color: var(--dcfmk-color-nav);
        }
        html.dcfmk-enabled .list_array_option .dcfmk-list-size-control .icon_option_more {
          position: absolute !important;
          top: 14px !important;
          right: 9px !important;
          width: 0 !important;
          height: 0 !important;
          margin: 0 !important;
          border: 4px solid transparent !important;
          border-top-color: #777 !important;
          background: none !important;
        }
        html.dcfmk-enabled .list_array_option .dcfmk-list-size-control > #listSizeLayer {
          position: absolute !important;
          z-index: 100;
          top: 35px !important;
          right: -1px !important;
          left: auto !important;
          box-sizing: border-box;
          width: 63px !important;
          margin: 0 !important;
          padding: 2px 0 !important;
          border: 1px solid #bbb;
          background: #fff;
          box-shadow: 0 3px 7px rgb(0 0 0 / 15%);
        }
        html.dcfmk-enabled .list_array_option .dcfmk-list-size-control > #listSizeLayer li {
          display: block;
          width: 100%;
          height: 24px;
          margin: 0;
          padding: 0;
        }
        html.dcfmk-enabled .list_array_option .dcfmk-list-size-control > #listSizeLayer a {
          display: block;
          box-sizing: border-box;
          width: 100%;
          height: 24px;
          padding: 0 7px;
          color: #555;
          font: 10px/24px var(--dcfmk-font);
          text-align: left;
          text-decoration: none;
          white-space: nowrap;
        }
        html.dcfmk-enabled .list_array_option .dcfmk-list-size-control > #listSizeLayer a:hover {
          background: #eef0f8;
          color: var(--dcfmk-color-nav);
        }
        html.dcfmk-enabled .dcfmk-list {
          border-top: 0;
        }
        html.dcfmk-enabled table.dcfmk-list-table {
          table-layout: auto;
        }
        html.dcfmk-enabled table.dcfmk-list-table thead th {
          box-sizing: border-box;
          height: 33px;
          padding: 7px 6px 5px;
          border-top: 1px solid #ccc;
          border-bottom: 1px solid #bbb;
          background: linear-gradient(to bottom, #fff 0, #f9f9f9 100%);
          box-shadow: inset 0 -1px 0 #fff;
          color: #555;
          font-size: 13px;
          white-space: nowrap;
        }
        html.dcfmk-enabled table.dcfmk-list-table tbody td {
          box-sizing: border-box;
          height: 36px;
          padding: 6px 6px 4px;
          color: #555;
          font-size: 11px;
          line-height: 20px;
        }
        html.dcfmk-enabled table.dcfmk-list-table .dcfmk-hidden-number {
          display: none !important;
        }
        html.dcfmk-enabled table.dcfmk-list-table .dcfmk-tab-cell {
          box-sizing: border-box;
          width: 68px;
          max-width: 68px;
          padding-left: 8px;
          padding-right: 8px;
          color: #369;
          text-align: center;
          white-space: nowrap;
        }
        html.dcfmk-enabled table.dcfmk-list-table .dcfmk-subject-filter-link {
          display: block;
          overflow: hidden;
          width: 100%;
          color: inherit;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcfmk-enabled table.dcfmk-list-table .dcfmk-subject-filter-link:hover,
        html.dcfmk-enabled table.dcfmk-list-table .dcfmk-subject-filter-link:focus-visible {
          color: var(--dcfmk-color-link);
          text-decoration: underline;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_tit {
          width: auto;
          padding: 6px 6px 4px;
          text-align: left;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_tit > a:not(.reply_numbox) {
          color: #222;
          font-size: 13px;
          line-height: 20px;
        }
        html.dcfmk-enabled.dcfmk-realtime-best table.dcfmk-list-table {
          table-layout: fixed;
        }
        html.dcfmk-enabled.dcfmk-realtime-best table.dcfmk-list-table colgroup col:nth-child(5),
        html.dcfmk-enabled.dcfmk-realtime-best table.dcfmk-list-table .gall_count {
          width: 68px;
          min-width: 68px;
        }
        html.dcfmk-enabled.dcfmk-realtime-best table.dcfmk-list-table
          tbody tr.thum > td {
          height: 57px;
          vertical-align: middle;
        }
        html.dcfmk-enabled.dcfmk-realtime-best table.dcfmk-list-table
          tbody tr.thum .gall_tit {
          padding-top: 3px;
          padding-bottom: 4px;
        }
        html.dcfmk-enabled.dcfmk-realtime-best table.dcfmk-list-table
          tbody tr.thum .gall_tit > a:not(.reply_numbox) {
          position: relative;
          display: inline-flex;
          box-sizing: border-box;
          align-items: center;
          min-height: 50px;
          padding-left: 80px;
          vertical-align: middle;
        }
        html.dcfmk-enabled.dcfmk-realtime-best table.dcfmk-list-table
          tbody tr.thum .thumimg {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 70px !important;
          height: 50px !important;
          overflow: hidden;
          transform: none !important;
          background: #f2f2f2;
        }
        html.dcfmk-enabled.dcfmk-realtime-best table.dcfmk-list-table
          tbody tr.thum .thumimg > img {
          position: static !important;
          display: block;
          width: 70px !important;
          height: 50px !important;
          object-fit: cover;
        }
        html.dcfmk-enabled.dcfmk-realtime-best table.dcfmk-list-table
          tbody tr.thum .reply_numbox {
          vertical-align: middle;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_writer {
          width: 108px;
          min-width: 94px;
          max-width: 116px;
          text-align: left;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_date {
          width: 72px;
          min-width: 72px;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_count,
        html.dcfmk-enabled table.dcfmk-list-table .gall_recommend {
          width: 52px;
          min-width: 45px;
        }
        html.dcfmk-enabled table.dcfmk-list-table .gall_recommend {
          color: #377ee9;
          font-weight: 700;
        }
        html.dcfmk-enabled table.dcfmk-list-table tr.dcfmk-row-notice,
        html.dcfmk-enabled table.dcfmk-list-table tbody tr:hover {
          background: #f6f6f6;
        }
        html.dcfmk-enabled table.dcfmk-list-table tbody tr.dcfmk-current-post,
        html.dcfmk-enabled table.dcfmk-list-table tbody tr.dcfmk-current-post:hover,
        html.dcfmk-enabled table.dcfmk-list-table tbody tr.dcfmk-current-post > td {
          background: #e9edf9 !important;
        }
        html.dcfmk-enabled table.dcfmk-list-table tbody tr.dcfmk-current-post .dcfmk-tab-cell {
          box-shadow: inset 3px 0 0 var(--dcfmk-color-nav-light);
          color: var(--dcfmk-color-nav);
          font-weight: 700;
        }
        html.dcfmk-enabled table.dcfmk-list-table tbody tr.dcfmk-current-post .gall_tit > a:not(.reply_numbox) {
          color: var(--dcfmk-color-nav);
          font-weight: 700;
        }
        html.dcfmk-enabled .list_bottom_btnbox {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu {
          display: flex;
          box-sizing: border-box;
          align-items: flex-start;
          justify-content: space-between;
          min-height: 43px;
          margin-top: -1px;
          padding: 7px 10px;
          border-top: 1px solid #ccc;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu form,
        html.dcfmk-enabled .dcfmk-fm-bottom-menu fieldset {
          margin: 0;
          padding: 0;
          border: 0;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu .buttom_search_wrap {
          display: flex;
          width: auto !important;
          height: 28px;
          margin: 0;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu .bottom_array {
          box-sizing: border-box;
          width: 105px;
          height: 28px;
          margin-left: 4px;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu .select_area {
          position: relative;
          box-sizing: border-box;
          width: 100% !important;
          max-width: 100% !important;
          height: 28px;
          overflow: hidden;
          padding: 0 24px 0 7px;
          border-radius: var(--dcfmk-control-radius);
          color: var(--dcfmk-color-nav-light);
          cursor: pointer;
          font: 10px/26px var(--dcfmk-font);
          white-space: nowrap;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu #search_type_txt {
          display: block;
          overflow: hidden;
          max-width: 72px;
          color: var(--dcfmk-color-nav-light);
          font-size: 10px;
          line-height: 26px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu .select_area > .inner {
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
          border-left-color: var(--dcfmk-control-addon-border);
          background: var(--dcfmk-control-addon-surface);
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu .select_area > .inner > .icon_option_more {
          position: static !important;
          display: block !important;
          box-sizing: content-box !important;
          width: 0 !important;
          height: 0 !important;
          margin: 3px 0 0 !important;
          border: 3px solid transparent !important;
          border-top-color: var(--dcfmk-color-nav-light) !important;
          background: none !important;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu .bottom_search {
          position: relative !important;
          box-sizing: border-box;
          width: 175px;
          height: 28px;
          overflow: hidden;
          margin-left: 0 !important;
          border-radius: var(--dcfmk-control-radius);
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu .bottom_search .inner_search {
          float: none !important;
          width: 100%;
          height: 26px;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu .bottom_search .in_keyword {
          box-sizing: border-box;
          width: 100%;
          height: 26px;
          padding-right: 32px !important;
          background: transparent;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu .buttom_search_wrap .bottom_search > .bnt_search {
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
        html.dcfmk-enabled .dcfmk-fm-bottom-menu .buttom_search_wrap .bottom_search > .bnt_search::before {
          position: absolute;
          top: 6px;
          left: 6px;
          box-sizing: border-box;
          width: 8px;
          height: 8px;
          border: 1.5px solid #596273;
          border-radius: 50%;
          content: "";
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-menu .buttom_search_wrap .bottom_search > .bnt_search::after {
          position: absolute;
          top: 14px;
          left: 13px;
          width: 5px;
          height: 1.5px;
          background: #596273;
          content: "";
          transform: rotate(45deg);
          transform-origin: left center;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-actions {
          display: flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 5px;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-button,
        html.dcfmk-enabled .list_array_option .dcfmk-top-write-button {
          display: inline-flex;
          box-sizing: border-box;
          height: 28px;
          align-items: center;
          justify-content: center;
          margin: 0;
          padding: 0 12px;
          border: 1px solid #ccc;
          border-radius: 3px;
          background: linear-gradient(to bottom, #fff 0, #f3f3f3 100%);
          color: #333;
          font: 11px/26px var(--dcfmk-font);
          letter-spacing: normal;
          white-space: normal;
          cursor: pointer;
          text-decoration: none;
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-actions > .dcfmk-fm-bottom-button,
        html.dcfmk-enabled .list_array_option .dcfmk-top-write-button {
          width: auto !important;
          min-width: 64px !important;
        }
        html.dcfmk-enabled .list_array_option .dcfmk-top-write-button {
          min-width: 70px !important;
          height: 32px;
          padding-right: 14px;
          padding-left: 14px;
          line-height: 30px;
        }
        html.dcfmk-enabled .dcfmk-fm-concept-button.dcfmk-active {
          color: #3262c5;
          font-weight: 700;
        }
        html.dcfmk-enabled .dcfmk-fm-write-button::before,
        html.dcfmk-enabled .list_array_option .dcfmk-top-write-button::before {
          width: auto;
          height: auto;
          margin: 0 4px 0 0;
          background: none;
          font: inherit;
          letter-spacing: normal;
          color: #666;
          content: "✎";
        }
        html.dcfmk-enabled .dcfmk-fm-bottom-button:hover,
        html.dcfmk-enabled .list_array_option .dcfmk-top-write-button:hover {
          border-color: #aaa;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
          text-decoration: none;
        }
        html.dcfmk-enabled .bottom_paging_wrap {
          box-sizing: border-box;
          height: 36px !important;
          min-height: 36px;
          margin-top: 0;
          padding-top: 10px;
          border-top: 0;
        }
        html.dcfmk-enabled .bottom_paging_box > a,
        html.dcfmk-enabled .bottom_paging_box > em {
          width: auto;
          min-width: 26px;
          height: 26px;
          padding: 0 6px !important;
          border-radius: 2px;
          color: #999;
          font: 700 12px/24px Tahoma, sans-serif;
        }
        html.dcfmk-enabled .bottom_paging_box > em {
          border-color: #aaa;
          background: #f9f9f9;
          color: #555;
        }
        html.dcfmk-enabled .bottom_paging_box .page_end,
        html.dcfmk-enabled .bottom_movebox {
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

      articleRoot.classList.add("dcfmk-article");
      const articleHeader = DcAdapter.articleHeader();
      const articleBody = DcAdapter.articleBody();
      const commentRoot = DcAdapter.commentRoot();
      articleHeader?.classList.add("dcfmk-article-header");
      articleBody?.classList.add("dcfmk-article-body");
      commentRoot?.classList.add("dcfmk-comments");
      this.decorateHeader(articleHeader);
      this.bindRecommendationReadinessGuard();
      this.mountQuickNavigation({ articleRoot, articleHeader, articleBody, commentRoot });
      this.injectStyle();
      this.bindResponsiveMovieFrames(articleBody);

      return { articleRoot, articleHeader, articleBody, commentRoot };
    },

    mountQuickNavigation({ articleRoot, articleHeader, articleBody, commentRoot }) {
      if (document.getElementById("dcfmk-article-quick-nav")) return;

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
          fallbackId: "dcfmk-article-top",
        },
        {
          role: "bottom",
          label: "아래로",
          icon: "\uf063",
          target: document.getElementById("bottom_listwrap")
            || document.querySelector(".view_bottom_btnbox")
            || articleBody,
          fallbackId: "dcfmk-article-bottom",
        },
        {
          role: "comments",
          label: "댓글로 가기",
          icon: "\uf075",
          target: commentRoot,
          fallbackId: "dcfmk-comments-anchor",
        },
      ];
      if (targets.some((item) => !item.target)) return;

      const nav = document.createElement("nav");
      nav.id = "dcfmk-article-quick-nav";
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
        icon.className = `dcfmk-quick-nav-icon dcfmk-quick-nav-icon-${item.role}`;
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
      if (!root || root.dataset.dcfmkMovieFramesBound === "true") return;
      root.dataset.dcfmkMovieFramesBound = "true";
      const selector = 'iframe[id^="movieIcon"][src*="/board/movie/movie_view"]';
      const prepare = (frame) => {
        if (!(frame instanceof HTMLIFrameElement)) return;
        if (frame.dataset.dcfmkResponsiveMovieBound !== "true") {
          frame.dataset.dcfmkResponsiveMovieBound = "true";
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

      let style = innerDocument.getElementById("dcfmk-responsive-movie-style");
      if (!style) {
        style = innerDocument.createElement("style");
        style.id = "dcfmk-responsive-movie-style";
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

      frame.__dcfmkMovieResizeObserver?.disconnect();
      const syncHeight = () => {
        if (!frame.isConnected || !container.isConnected) return;
        const height = Math.ceil(container.getBoundingClientRect().height);
        if (height > 0) frame.style.setProperty("height", `${height}px`, "important");
      };
      const resizeObserver = new ResizeObserver(syncHeight);
      resizeObserver.observe(container);
      frame.__dcfmkMovieResizeObserver = resizeObserver;
      innerDocument.defaultView?.requestAnimationFrame(() => {
        syncHeight();
        innerDocument.defaultView?.requestAnimationFrame(syncHeight);
      });
    },

    bindRecommendationReadinessGuard() {
      if (document.documentElement.dataset.dcfmkRecommendationGuard === "true") return;
      document.documentElement.dataset.dcfmkRecommendationGuard = "true";
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
      if (!articleHeader || articleHeader.dataset.dcfmkHeaderDecorated === "true") return;

      const title = articleHeader.querySelector(".title");
      const originalDate = articleHeader.querySelector(".gall_date");
      if (title && originalDate) {
        const date = document.createElement("span");
        date.className = "dcfmk-article-date";
        date.textContent = cleanText(originalDate.getAttribute("title") || originalDate.textContent);
        title.appendChild(date);
        originalDate.classList.add("dcfmk-original-date");
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

      articleHeader.dataset.dcfmkHeaderDecorated = "true";
    },

    injectStyle() {
      if (document.getElementById("dcfmk-article-style")) return;

      const fontAwesomeUrl = GM_getResourceURL("dcfmk-fontawesome");
      const style = document.createElement("style");
      style.id = "dcfmk-article-style";
      style.textContent = `
        @font-face {
          font-family: "dcfmk-FontAwesome";
          src: url("${fontAwesomeUrl}") format("woff2");
          font-style: normal;
          font-weight: normal;
          font-display: block;
        }
        #dcfmk-article-quick-nav {
          display: none;
        }
        html.dcfmk-enabled #dcfmk-article-quick-nav {
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
          border: 1px solid #d3d3d3;
          border-radius: 4px;
          background: #fcfcfc;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
          font-family: var(--dcfmk-font);
        }
        html.dcfmk-enabled #dcfmk-article-quick-nav > a {
          position: relative;
          display: flex;
          box-sizing: border-box;
          width: 28px;
          height: 28px;
          align-items: center;
          justify-content: center;
          margin: 0;
          padding: 0;
          border-bottom: 1px solid #e1e1e1;
          color: #888;
          text-decoration: none;
        }
        html.dcfmk-enabled #dcfmk-article-quick-nav > a:last-child {
          border-bottom: 0;
        }
        html.dcfmk-enabled #dcfmk-article-quick-nav > a:hover,
        html.dcfmk-enabled #dcfmk-article-quick-nav > a:focus-visible {
          z-index: 1;
          background: #f3f5fa;
          color: var(--dcfmk-color-nav-light);
          outline: 0;
        }
        html.dcfmk-enabled #dcfmk-article-quick-nav > a > b {
          position: absolute;
          overflow: hidden;
          width: 1px;
          height: 1px;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        html.dcfmk-enabled #dcfmk-article-quick-nav .dcfmk-quick-nav-icon {
          display: inline-block;
          flex: 0 0 auto;
          width: 16px;
          color: currentColor;
          font: normal normal normal 13px/1 "dcfmk-FontAwesome";
          text-align: center;
          text-rendering: auto;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        html.dcfmk-enabled #top,
        html.dcfmk-enabled #bottom_listwrap,
        html.dcfmk-enabled #dcfmk-article-top,
        html.dcfmk-enabled #dcfmk-article-bottom,
        html.dcfmk-enabled #dcfmk-comments-anchor {
          scroll-margin-top: 8px;
        }
        html.dcfmk-enabled .dcfmk-article {
          box-sizing: border-box;
          width: 100%;
          color: var(--dcfmk-color-text);
          font-family: var(--dcfmk-font);
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header {
          margin: 0;
          padding: 0;
          border-top: 2px solid var(--dcfmk-color-nav-light);
          border-bottom: 1px solid var(--dcfmk-color-border);
          background: #fff;
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .title {
          min-height: 52px;
          margin: 0;
          padding: 15px 12px 11px;
          color: #222;
          font-size: 19px;
          font-weight: 700;
          line-height: 25px;
          letter-spacing: -0.4px;
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .gall_writer {
          min-height: 38px;
          padding: 9px 12px;
          border-top: 1px solid #eee;
          background: var(--dcfmk-color-subtle);
          color: var(--dcfmk-color-muted);
          line-height: 19px;
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .gall_writer .nickname,
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .gall_writer .nickname em {
          color: #444;
          font-weight: 700;
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .gall_date {
          margin-left: 9px;
          color: #888;
          font-size: 11px;
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .fr > span {
          margin-left: 10px;
          color: var(--dcfmk-color-muted);
          font-size: 11px;
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .gall_comment a {
          color: var(--dcfmk-color-link);
          text-decoration: none;
        }
        html.dcfmk-enabled .dcfmk-article-body {
          border-bottom: 0;
          background: #fff;
        }
        html.dcfmk-enabled .dcfmk-article-body > .inner {
          box-sizing: border-box;
          width: 100%;
          padding: 32px 12px 22px;
        }
        html.dcfmk-enabled .dcfmk-article-body .writing_view_box,
        html.dcfmk-enabled .dcfmk-article-body .write_div {
          box-sizing: border-box;
          width: 100% !important;
          max-width: 100%;
          color: #222;
          font-size: 14px;
          line-height: 1.7;
        }
        html.dcfmk-enabled .dcfmk-article-body .writing_view_box img,
        html.dcfmk-enabled .dcfmk-article-body .writing_view_box video {
          max-width: 100% !important;
          height: auto !important;
        }
        html.dcfmk-enabled .dcfmk-article-body .writing_view_box iframe,
        html.dcfmk-enabled .dcfmk-article-body .writing_view_box embed {
          max-width: 100% !important;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box {
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-article-body .recom_bottom_box {
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-article-body .appending_file_box {
          margin-top: 24px;
          padding: 10px 12px;
          border: 1px solid var(--dcfmk-color-border);
          background: var(--dcfmk-color-subtle);
          color: var(--dcfmk-color-muted);
        }
        html.dcfmk-enabled .view_bottom_btnbox {
          min-height: 44px;
          padding-top: 10px;
          border-top: 1px solid var(--dcfmk-color-border);
        }
        html.dcfmk-enabled .view_bottom_btnbox button {
          height: 30px;
          border: 1px solid var(--dcfmk-color-nav-light);
          border-radius: 0;
          background: var(--dcfmk-color-nav-light);
          color: #fff;
          line-height: 28px;
        }
        html.dcfmk-enabled .dcfmk-comments {
          margin-top: 28px;
          border-top: 2px solid var(--dcfmk-color-nav-light);
          color: var(--dcfmk-color-text);
          font-family: var(--dcfmk-font);
        }
        html.dcfmk-enabled .dcfmk-comments .comment_count {
          box-sizing: border-box;
          min-height: 42px;
          padding: 10px 12px;
          border-bottom: 1px solid var(--dcfmk-color-border);
          background: var(--dcfmk-color-subtle);
        }
        html.dcfmk-enabled .dcfmk-comments .comment_count .font_red {
          color: var(--dcfmk-color-link);
        }
        html.dcfmk-enabled .dcfmk-comments .comment_box {
          border-bottom: 1px solid var(--dcfmk-color-border);
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_list {
          margin: 0;
          padding: 0;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_info {
          position: relative;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_info > .addbox {
          display: flex !important;
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          padding-right: 140px;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_info > .addbox > .cmt_nickbox {
          float: none !important;
          flex: 0 0 152px;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_info > .addbox > .cmt_txtbox {
          float: none !important;
          flex: 1 1 auto;
          width: auto !important;
          max-width: calc(100% - 152px);
          min-width: 0;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_info > .fr {
          position: absolute;
          top: 9px;
          right: 3px;
          float: none !important;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_info > .addbox > .fr {
          position: absolute;
          top: 9px;
          right: 3px;
          float: none !important;
        }
        html.dcfmk-enabled .dcfmk-comments .reply_info {
          position: relative;
          min-width: 0;
        }
        html.dcfmk-enabled .dcfmk-comments .reply_info:not(:has(> .addbox)) {
          display: flex;
          box-sizing: border-box;
          width: 100%;
          padding-right: 140px;
        }
        html.dcfmk-enabled .dcfmk-comments .reply_info > .addbox {
          display: flex !important;
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          padding-right: 140px;
        }
        html.dcfmk-enabled .dcfmk-comments .reply_info > .cmt_nickbox,
        html.dcfmk-enabled .dcfmk-comments .reply_info > .addbox > .cmt_nickbox {
          float: none !important;
          flex: 0 0 133px;
        }
        html.dcfmk-enabled .dcfmk-comments .reply_info > .cmt_txtbox,
        html.dcfmk-enabled .dcfmk-comments .reply_info > .usertxt,
        html.dcfmk-enabled .dcfmk-comments .reply_info > .addbox > .cmt_txtbox,
        html.dcfmk-enabled .dcfmk-comments .reply_info > .addbox > .usertxt {
          float: none !important;
          flex: 1 1 auto;
          width: auto !important;
          max-width: calc(100% - 133px);
          min-width: 0;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_info .cmt_txtbox > .usertxt,
        html.dcfmk-enabled .dcfmk-comments .reply_info .cmt_txtbox > .usertxt {
          box-sizing: border-box;
          width: auto !important;
          max-width: 100%;
          min-width: 0;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_txtbox:has(> .comment_dccon) {
          display: inline-flex !important;
          flex: 1 1 auto;
          flex-flow: row nowrap;
          align-items: flex-start;
          width: auto !important;
          max-width: 100%;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_txtbox:has(> .mention) {
          flex-wrap: wrap;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_txtbox:has(> .mention) > .mention {
          flex: 0 0 100%;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_txtbox > .comment_dccon,
        html.dcfmk-enabled .dcfmk-comments .reply_info .comment_dccon {
          float: none !important;
          flex: 0 0 auto;
          width: auto !important;
          max-width: none;
        }
        html.dcfmk-enabled .dcfmk-comments .reply_info > .fr {
          position: absolute;
          top: 0;
          right: 0;
          float: none !important;
        }
        html.dcfmk-enabled .dcfmk-comments .reply_info > .addbox > .fr {
          position: absolute;
          top: 0;
          right: 0;
          float: none !important;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_info {
          color: var(--dcfmk-color-muted);
          font-size: 11px;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_nickbox .nickname,
        html.dcfmk-enabled .dcfmk-comments .cmt_nickbox .nickname em {
          color: #444;
          font-weight: 700;
        }
        html.dcfmk-enabled .dcfmk-user-identifier {
          margin-left: 3px;
          color: #888;
          font-size: 10px;
          font-weight: 400;
          pointer-events: none;
        }
        html.dcfmk-enabled table.dcfmk-list-table .dcfmk-user-identifier {
          font-size: 9px;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_txtbox {
          padding-top: 0;
          color: #222;
          font-size: 13px;
          line-height: 1.6;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box {
          padding-top: 19px !important;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box {
          box-sizing: border-box;
          width: 100%;
          margin-top: 12px;
          padding: 12px;
          border: 1px solid var(--dcfmk-color-border);
          background: var(--dcfmk-color-subtle);
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box input,
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box textarea {
          border: 1px solid #ccc;
          border-radius: 0;
          background: #fff;
          color: var(--dcfmk-color-text);
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box textarea {
          box-sizing: border-box;
          width: 100%;
          min-height: 78px;
          padding: 9px;
          resize: vertical;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box button {
          border-radius: 0;
        }
        html.dcfmk-enabled .dcfmk-comments .btn_cmt_refresh,
        html.dcfmk-enabled .dcfmk-comments .btn_cmt_close,
        html.dcfmk-enabled .dcfmk-comments .contgo {
          color: var(--dcfmk-color-muted);
          font-size: 13px;
        }
        html.dcfmk-enabled .dcfmk-comments .comment_box > .bottom_paging_box {
          height: auto !important;
          min-height: 38px !important;
          padding: 6px 0 !important;
        }
        html.dcfmk-enabled .dcfmk-comments .comment_box > .bottom_paging_box > .cmt_paging {
          display: flex;
          flex: 0 1 auto;
          height: 26px;
          align-items: center;
          justify-content: center;
          padding: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-comments .comment_box > .bottom_paging_box > .cmt_inner {
          top: 50% !important;
          margin-top: 0 !important;
          transform: translateY(-50%);
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header {
          margin: 0 0 20px;
          border-top: 1px solid #ccc !important;
          border-bottom: 1px solid #ccc;
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .title {
          position: relative;
          box-sizing: border-box;
          min-height: 43px;
          padding: 11px 155px 9px 11px;
          border-bottom: 1px solid #ccc;
          background: #fcfcfc;
          color: #222;
          font-size: 17px;
          line-height: 18px;
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .dcfmk-article-date {
          position: absolute;
          top: 13px;
          right: 11px;
          color: #888;
          font-size: 11px;
          font-weight: 400;
          letter-spacing: 0;
          white-space: nowrap;
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .gall_writer {
          min-height: 34px;
          padding: 7px 11px;
          border-top: 0;
          background: #fff;
          line-height: 19px;
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .dcfmk-original-date,
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .gall_scrap {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-article .dcfmk-article-header .fr > span {
          margin-left: 12px;
          color: #777;
          font-size: 11px;
        }
        html.dcfmk-enabled .dcfmk-article-body > .inner {
          margin-bottom: 0 !important;
          padding: 20px 15px 0;
        }
        html.dcfmk-enabled .dcfmk-article-body .writing_view_box,
        html.dcfmk-enabled .dcfmk-article-body .write_div {
          min-height: 0 !important;
          margin-bottom: 0 !important;
          padding-bottom: 0 !important;
          font-size: 13px;
          line-height: 1.6;
        }
        /* 1.9.37의 분할 추천 UI는 원본 디시 컨트롤을 사용하도록 비활성화한다. */
        @media not all {
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box {
          width: 100%;
          min-height: 0 !important;
          height: auto !important;
          margin-top: 8px !important;
          margin-bottom: 0 !important;
          padding: 6px 0 2px;
          border: 0;
          border-top: 1px solid #eee;
          background: transparent;
        }
        html.dcfmk-enabled .dcfmk-article-body .positionr {
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box > .inner_box {
          display: flex;
          width: auto;
          height: 34px;
          align-items: stretch;
          justify-content: center;
          gap: 8px;
          margin: 0 auto;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box > .inner_box > .inner {
          display: grid;
          box-sizing: border-box;
          grid-template-columns: 34px 42px;
          width: 76px;
          height: 34px;
          align-items: center;
          margin: 0;
          padding: 0;
          overflow: hidden;
          border: 1px solid #cfd3da;
          border-radius: 4px;
          background: #fff;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box > .inner_box > .inner:has(.btn_recom_up) {
          grid-template-columns: 34px 84px;
          width: 118px;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_up,
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_down {
          grid-column: 1;
          grid-row: 1;
          box-sizing: border-box;
          width: 34px;
          min-width: 34px;
          height: 34px;
          margin: 0;
          border: 0;
          border-right: 1px solid #e1e4e9;
          border-radius: 0;
          padding: 0;
          background: #f6f7f9;
          box-shadow: none;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_up:hover,
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_down:hover {
          background: #eef2f8;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_up::after,
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_down::after {
          content: none;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_up::before,
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_down::before {
          display: block;
          width: 32px;
          height: 32px;
          color: #3159ae;
          font-family: Arial, sans-serif;
          font-weight: 700;
          line-height: 32px;
          text-align: center;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_up::before {
          content: "☆";
          font-size: 25px;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_up.on::before {
          content: "★";
          color: #e2a900;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_down::before {
          content: "×";
          color: #657083;
          font-size: 27px;
          font-weight: 400;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_up em,
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .btn_recom_down em {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .up_num_box,
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .down_num_box {
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
          background: #fff;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .up_num_box {
          grid-template-columns: 42px 42px;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .down_num_box {
          grid-template-columns: 42px;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .up_num_box .up_num,
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .down_num_box .down_num,
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .up_num_box .sup_num {
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
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .up_num_box .sup_num {
          gap: 3px;
          border-left: 1px solid #e1e4e9;
          color: #555;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .up_num_box .sup_num .writer_nikcon {
          display: inline-flex;
          align-items: center;
          margin: 0;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .up_num_box .sup_num img {
          display: block;
          width: auto;
          max-width: 13px !important;
          height: auto !important;
          max-height: 13px;
          margin: 0;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .up_num_box .up_num {
          color: #377ee9;
        }
        html.dcfmk-enabled .dcfmk-article-body .btn_recommend_box .down_num_box .down_num {
          color: #777;
        }
        html.dcfmk-enabled .dcfmk-article-body .recom_bottom_box {
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
        html.dcfmk-enabled .dcfmk-article-body .recom_bottom_box button {
          float: none !important;
          min-width: 0;
          height: 22px;
          margin: 0 !important;
          padding: 0 6px;
          line-height: 20px;
          white-space: nowrap;
        }
        }
        html.dcfmk-enabled .dcfmk-article-body .positionr {
          margin-top: 30px !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-comments {
          margin-top: 10px !important;
        }
        html.dcfmk-enabled .dcfmk-article-body > div:not([class])[style*="width:100%"][style*="text-align:center"] {
          display: none !important;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr);
          row-gap: 5px;
          width: 100% !important;
          min-height: 0 !important;
          margin-top: 8px;
          padding: 8px;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box > .fl {
          display: flex;
          float: none !important;
          width: auto !important;
          min-width: 0;
          min-height: 18px;
          align-items: center;
          gap: 5px;
          margin: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box .user_info_input {
          box-sizing: border-box;
          width: auto !important;
          min-width: 96px;
          margin: 0 !important;
          border-right: 1px solid #cecdce !important;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box .user_info_input label {
          display: block;
          box-sizing: border-box;
          overflow: hidden;
          width: 100%;
          margin: 0;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box .user_info_input.id > label {
          width: 100% !important;
          height: 100%;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box .user_info_input input {
          box-sizing: border-box;
          width: 100px !important;
          min-width: 80px;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box > .cmt_txt_cont {
          float: none !important;
          box-sizing: border-box;
          width: auto !important;
          min-width: 0;
          margin: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box .cmt_write {
          float: none !important;
          box-sizing: border-box;
          width: 100% !important;
          min-width: 0;
          margin: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box .cmt_write textarea {
          display: block;
          box-sizing: border-box;
          width: 100% !important;
          min-width: 0;
          min-height: 70px;
          height: 70px;
          margin: 0 !important;
          padding: 7px 8px;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box .cmt_textarea_label {
          box-sizing: border-box;
          width: 100% !important;
          padding: 7px 8px;
          font-size: 11px;
          line-height: 18px;
        }
        html.dcfmk-enabled .dcfmk-comments .cmt_write_box .cmt_cont_bottm {
          box-sizing: border-box;
          width: 100% !important;
          min-height: 26px;
          margin-top: 5px;
        }
        html.dcfmk-enabled .view_bottom_btnbox {
          box-sizing: border-box;
          width: 100%;
          min-height: 27px;
          height: 27px;
          margin: 7px 0 5px !important;
          padding: 0 !important;
          border-top: 0;
        }
        html.dcfmk-enabled .view_bottom_btnbox > .fl,
        html.dcfmk-enabled .view_bottom_btnbox > .fr {
          display: flex;
          align-items: center;
          gap: 4px;
          height: 27px;
        }
        html.dcfmk-enabled .view_bottom_btnbox button {
          box-sizing: border-box;
          min-width: 54px;
          height: 26px;
          padding: 0 10px;
          border: 1px solid #ccc;
          border-radius: 3px;
          background: linear-gradient(to bottom, #fff 0, #f3f3f3 100%);
          color: #333;
          font-family: var(--dcfmk-font) !important;
          font-size: 11px !important;
          font-style: normal;
          line-height: 24px !important;
          letter-spacing: normal;
          white-space: nowrap;
        }
        html.dcfmk-enabled .view_bottom_btnbox > .fr .write {
          font-weight: 400 !important;
        }
        html.dcfmk-enabled .view_bottom_btnbox > .fl .concept.btn_lightpurple {
          border-color: var(--dcfmk-color-nav-light) !important;
          background: var(--dcfmk-color-nav-light) !important;
          color: #fff !important;
          font-weight: 700 !important;
        }
        html.dcfmk-enabled .view_bottom_btnbox > .fl .concept.btn_whitepurple {
          border-color: #ccc !important;
          background: linear-gradient(to bottom, #fff 0, #f3f3f3 100%) !important;
          color: #333 !important;
          font-weight: 400 !important;
        }
        html.dcfmk-enabled.dcfmk-page-view #bottom_listwrap,
        html.dcfmk-enabled.dcfmk-page-view #bottom_listwrap > .left_content,
        html.dcfmk-enabled.dcfmk-page-view #bottom_listwrap > .left_content > article,
        html.dcfmk-enabled.dcfmk-page-view #bottom_listwrap .gall_listwrap {
          margin-top: 0 !important;
          padding-top: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-comments {
          border-top: 0;
        }
        html.dcfmk-enabled .dcfmk-comments .comment_count {
          min-height: 38px;
          padding: 8px 12px;
          border: 1px solid #ddd !important;
          border-radius: 4px;
          background: linear-gradient(to bottom, #fff 0, #f9f9f9 100%);
          color: #555;
          font-size: 13px;
        }
        html.dcfmk-enabled .dcfmk-comments .comment_box {
          border-top: 0 !important;
        }
        html.dcfmk-enabled .dcfmk-comments .nomem_comment_info {
          display: block !important;
          float: none !important;
          clear: both;
          box-sizing: border-box;
          width: 100% !important;
          margin-right: 0 !important;
          margin-left: 0 !important;
          text-align: center !important;
        }
        html.dcfmk-enabled .dcfmk-comments .repley_add_vote {
          display: none !important;
        }
      `;
      document.documentElement.appendChild(style);
    },
  });

  function releaseEarlyShield() {
    requestAnimationFrame(() => {
      earlyShieldObserver?.disconnect();
      document.documentElement.classList.remove("dcfmk-booting");
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
