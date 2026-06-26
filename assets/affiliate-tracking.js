(function () {
  const POSTHOG_HOST = 'https://us.i.posthog.com';
  const POSTHOG_API_KEY = 'phc_bjXi1mYTYZTzuTmaCq7BUTEbdGJOGegDvklVMx5IuTP';
  const CLIENT_ID_KEY = 'pixsort_affiliate_client_id_v1';

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  }

  function clientId() {
    try {
      const existing = window.localStorage.getItem(CLIENT_ID_KEY);
      if (existing) return existing;
      const next = uuid();
      window.localStorage.setItem(CLIENT_ID_KEY, next);
      return next;
    } catch {
      return uuid();
    }
  }

  function appsFlyerUrl() {
    const configured = window.PIXSORT_AFFILIATE && window.PIXSORT_AFFILIATE.appLink;
    if (configured) return configured;

    const appLink = document.querySelector('a[href^="https://app.appsflyer.com/id6760485464"]');
    if (appLink) return appLink.href;

    const scripts = Array.from(document.scripts || []);
    for (const script of scripts) {
      const match = (script.textContent || '').match(/APP_STORE_URL\s*=\s*'([^']+app\.appsflyer\.com\/id6760485464[^']+)'/);
      if (match) return match[1];
    }
    return null;
  }

  function attribution() {
    const dataset = document.body ? document.body.dataset : {};
    const configured = window.PIXSORT_AFFILIATE || {};
    const link = appsFlyerUrl();
    let url = null;
    try {
      url = link ? new URL(link.replace(/&amp;/g, '&')) : null;
    } catch {
      url = null;
    }

    const partnerId = configured.partnerId || dataset.affiliatePartnerId || (url && (url.searchParams.get('af_sub1') || url.searchParams.get('pid')));
    const campaignId = configured.campaignId || dataset.affiliateCampaignId || (url && (url.searchParams.get('af_sub2') || url.searchParams.get('c')));
    const clickId = configured.clickId || dataset.affiliateClickId || (url && url.searchParams.get('af_sub3'));

    if (!partnerId) return null;
    return {
      partnerId,
      campaignId: campaignId || '',
      clickId: clickId || '',
    };
  }

  function capture(event, extra) {
    const attr = attribution();
    if (!attr) return;

    const payload = {
      api_key: POSTHOG_API_KEY,
      event,
      distinct_id: 'affiliate-page-' + attr.partnerId + '-' + clientId(),
      properties: {
        partner_id: attr.partnerId,
        campaign_id: attr.campaignId,
        click_id: attr.clickId,
        source_path: window.location.pathname,
        source_host: window.location.hostname,
        referrer: document.referrer || null,
        user_agent: navigator.userAgent || null,
        ...extra,
      },
    };

    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(POSTHOG_HOST + '/capture/', new Blob([body], { type: 'application/json' }));
      if (sent) return;
    }

    fetch(POSTHOG_HOST + '/capture/', {
      method: 'POST',
      mode: 'cors',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  }

  window.pixsortAffiliateRedirect = function (targetHref) {
    if (!targetHref) return;
    capture('pixsort_partner_app_store_clicked', {
      source_surface: 'affiliate_landing_page',
      target_href: targetHref,
      redirect_mode: 'programmatic',
    });
    window.setTimeout(function () {
      window.location.href = targetHref;
    }, 80);
  };

  capture('pixsort_partner_link_clicked', { source_surface: 'affiliate_landing_page' });

  document.addEventListener('click', function (event) {
    const link = event.target && event.target.closest
      ? event.target.closest('a[href^="https://app.appsflyer.com/id6760485464"]')
      : null;
    if (!link) return;
    capture('pixsort_partner_app_store_clicked', {
      source_surface: 'affiliate_landing_page',
      target_href: link.href,
      redirect_mode: 'anchor',
    });
  }, true);
})();
