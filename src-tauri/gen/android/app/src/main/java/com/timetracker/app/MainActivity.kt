package com.timetracker.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.view.View
import android.view.ViewGroup
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class StatusBarBridge {
    private var _top: Float = 0f
    private var _bottom: Float = 0f

    fun setValues(top: Float, bottom: Float) {
        _top = top
        _bottom = bottom
    }

    @JavascriptInterface fun getTop(): Float = _top
    @JavascriptInterface fun getBottom(): Float = _bottom
}

class TimerBridge(private val activity: MainActivity) {
    companion object {
        const val CHANNEL_ID = "timer_channel"
        const val NOTIF_ID = 1
        const val EXTRA_TASK_ID = "task_id"
    }

    init {
        val channel = NotificationChannel(
            CHANNEL_ID, "Laufende Timer", NotificationManager.IMPORTANCE_LOW
        ).apply { setShowBadge(false) }
        activity.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(channel)
    }

    @JavascriptInterface
    fun startTimer(taskId: String, taskName: String, startTime: Long) {
        activity.runOnUiThread {
            val stopIntent = Intent(activity, StopReceiver::class.java)
                .putExtra(EXTRA_TASK_ID, taskId)
            val stopPending = PendingIntent.getBroadcast(
                activity, 0, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val openPending = PendingIntent.getActivity(
                activity, 0, Intent(activity, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val notification = Notification.Builder(activity, CHANNEL_ID)
                .setContentTitle(taskName)
                .setContentText("Zeiterfassung läuft")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(true)
                .setUsesChronometer(true)
                .setWhen(startTime)
                .setContentIntent(openPending)
                .addAction(android.R.drawable.ic_media_pause, "Stoppen", stopPending)
                .build()
            activity.getSystemService(NotificationManager::class.java)
                .notify(NOTIF_ID, notification)
        }
    }

    @JavascriptInterface
    fun stopTimer() {
        activity.runOnUiThread {
            activity.getSystemService(NotificationManager::class.java).cancel(NOTIF_ID)
        }
    }
}

class MainActivity : TauriActivity() {
    private val statusBarBridge = StatusBarBridge()
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        requestNotificationPermission()

        // addJavascriptInterface requires a page reload to be visible —
        // delay to let Tauri finish its setup, then add + reload once.
        handler.postDelayed({
            findWebView(window.decorView)?.let { wv ->
                WebViewHolder.webView = wv
                wv.addJavascriptInterface(statusBarBridge, "AndroidStatusBar")
                wv.addJavascriptInterface(TimerBridge(this), "AndroidTimer")
                wv.reload()
            }
        }, 400)

        ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, insets ->
            val density = resources.displayMetrics.density
            statusBarBridge.setValues(
                insets.getInsets(WindowInsetsCompat.Type.statusBars()).top / density,
                insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom / density
            )
            ViewCompat.onApplyWindowInsets(view, insets)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        WebViewHolder.webView = null
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001
            )
        }
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                findWebView(view.getChildAt(i))?.let { return it }
            }
        }
        return null
    }
}
