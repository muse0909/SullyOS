package com.aetheros.simulator;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 暮色 2026-08-26 角色查手机 P0：注册 PhoneUsagePlugin
        //   Capacitor Bridge 通过 registerPlugin 注册到 bridge，
        //   之后 JS 端可通过 Capacitor.Plugins.PhoneUsage.* 调用
        //   在 server.url 远程加载模式下，Bridge 仍会通过 WebViewClient.onPageStarted 注入到页面 DOM，
        //   所以 PhoneUsagePlugin 在远程页面也能正常调
        registerPlugin(PhoneUsagePlugin.class);

        // 暮色 2026-08-29 后台保活 P0 第一步：注册 KeepAlivePlugin
        //   暴露 start() / stop() 给前端，让 index.tsx 在 appStateChange
        //   切回前台时确认 KeepAliveService 还活着（兜底重启）。
        //   下面第 44-50 行的 startForegroundService 是 8-27 已有的直启，**不要动**。
        registerPlugin(KeepAlivePlugin.class);

        // 必须先 super.onCreate（它会初始化 bridge + WebView + 按 capacitor.config 加载 URL）
        super.onCreate(savedInstanceState);

        // 暮色 2026-08-29 后台保活 P0 第二步：申请 POST_NOTIFICATIONS 权限（Android 13+ 强制）
        //   不申请的话 KeepAliveService 收到的主动消息完全弹不出来（用户在系统设置里也得手动开）
        //   放在 startForegroundService 之前 — 申请是非阻塞弹窗，先确保权限再起服务
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    1001
                );
            }
        }

        // 暮色 2026-08-27：原生 WebView 缩放方案（setInitialScale/setSupportZoom 等）已撤销，
        //   改用纯前端 CSS zoom —— 前端 utils/pageZoom.ts + 设置页「页面缩放」滑条，
        //   远程加载模式下不用重新打包。此处恢复 Capacitor 默认缩放配置，无需任何代码。

        // 暮色 2026-08-27 底部白边修复（P0 第 7 项）：沉浸式全屏
        //   - setDecorFitsSystemWindows(false)：让内容延伸进状态栏 / 导航栏区域（edge-to-edge）
        //   - navigationBarColor 透明：系统导航栏背景变透明，露出底下 WebView 内容，不再有白边
        //   - 状态栏也一并透明，顶部同样无遮挡
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().setStatusBarColor(Color.TRANSPARENT);

        //   WebView 自己不吃 system window inset（默认 CoordinatorLayout root 会吃），
        //   强制 false 让页面自己管布局 —— 前端 viewport-fit=cover 会处理好刘海/圆角
        this.bridge.getWebView().setFitsSystemWindows(false);
        ViewGroup.LayoutParams lp = this.bridge.getWebView().getLayoutParams();
        lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
        lp.height = ViewGroup.LayoutParams.MATCH_PARENT;
        this.bridge.getWebView().setLayoutParams(lp);

        // 暮色 2026-08-27 后台保活（P0 第 5 项）：启动轻量前台服务
        //   常驻一条静默"运行中"通知，防止后台杀进程（消息推送 / 主动唤醒依赖）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(new Intent(this, KeepAliveService.class));
        } else {
            startService(new Intent(this, KeepAliveService.class));
        }
    }
}
