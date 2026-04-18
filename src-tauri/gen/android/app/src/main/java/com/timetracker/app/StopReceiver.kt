package com.timetracker.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.app.NotificationManager

class StopReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getStringExtra(TimerBridge.EXTRA_TASK_ID) ?: return

        context.getSystemService(NotificationManager::class.java)
            .cancel(TimerBridge.NOTIF_ID)

        val escaped = taskId.replace("'", "\\'")
        WebViewHolder.webView?.post {
            WebViewHolder.webView?.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('notification-stop',{detail:{taskId:'$escaped'}}))",
                null
            )
        }
    }
}
