package com.operacaoindustria.tclremote;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.view.WindowCompat;

public final class MainActivity extends Activity {
    private static final String REMOTE_URL =
            "https://operacaoindustria-boop.github.io/controleremotopw/";
    private static final String REMOTE_HOST = "operacaoindustria-boop.github.io";
    private static final String REMOTE_PATH = "/controleremotopw/";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

        webView = new WebView(this);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                boolean isRemotePage = "https".equals(uri.getScheme())
                        && REMOTE_HOST.equals(uri.getHost())
                        && (REMOTE_PATH.equals(uri.getPath())
                        || uri.getPath().startsWith(REMOTE_PATH));
                return !isRemotePage;
            }
        });
        setContentView(webView);
        webView.loadUrl(REMOTE_URL);
        webView.requestFocus(View.FOCUS_DOWN);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (event.getRepeatCount() == 0 && webView != null) {
                String direction = keyCode == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down";
                webView.evaluateJavascript(
                        "window.handlePhoneVolumeKey && window.handlePhoneVolumeKey('"
                                + direction + "')",
                        null
                );
            }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
