package com.sobhnathx.jeestudy;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Bundle;

import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // An APK installed over an older version keeps the WebView's HTTP cache.
        // Stale HTML / chunk entries from the previous build then poison the new
        // one: code that was requested on demand (lazy chunks) failed with
        // "Failed to load chunk /_next/static/chunks/…" even though the file was
        // bundled. Clearing the HTTP cache whenever the app version changes
        // removes that whole class of bugs. clearCache() does NOT touch
        // IndexedDB or localStorage — user data and the sync session survive.
        try {
            SharedPreferences prefs = getPreferences(Context.MODE_PRIVATE);
            String seen = prefs.getString("cache_cleared_for_version", "");
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            String current = String.valueOf(PackageInfoCompat.getLongVersionCode(info));
            if (!current.equals(seen) && getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().clearCache(true);
                prefs.edit().putString("cache_cleared_for_version", current).apply();
            }
        } catch (Exception ignored) {
            // cache clearing is best-effort; never block app start
        }
    }
}
