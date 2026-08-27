// KeepAliveService — 轻量前台保活服务（暮色 2026-08-27 P0 第 5 项）
//
// 目的：防止系统在后台把 WebView 进程杀掉 — 消息推送 / 主动唤醒依赖进程存活。
// 实现：起一个 IMPORTANCE_LOW 的常驻通知（"运行中"），不发声不弹横幅，
//   用户在通知栏里能看到一条静默通知，划不掉（ongoing）。
//
// Android 14 (API 34) 要求：
//   - manifest 里 FOREGROUND_SERVICE + FOREGROUND_SERVICE_SPECIAL_USE 权限
//   - <service> 上声明 android:foregroundServiceType="specialUse"
//   - PROPERTY_SPECIAL_USE_FGS_SUBTYPE property 说明用途
//   - startForeground 时传 FOREGROUND_SERVICE_TYPE_SPECIAL_USE

package com.aetheros.simulator

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class KeepAliveService : Service() {

    companion object {
        private const val CHANNEL_ID = "keep_alive_channel"
        private const val NOTIFICATION_ID = 1001
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("手抓糯米机")
            .setContentText("运行中")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)                 // 划不掉
            .setSilent(true)                  // 不出声、不弹横幅、不闪灯
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        // Android 14+ 必须显式传 FGS 类型，老版本走单参数重载
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // START_STICKY：万一进程真被杀了，系统重启时会拉回这个服务
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "保持运行",
                NotificationManager.IMPORTANCE_LOW   // 静默，不出现在锁屏顶部大字提示里
            ).apply {
                description = "维持 SullyOS 后台运行与消息推送"
                setShowBadge(false)                  // 角标不加
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
