package com.aetheros.simulator;

import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebSettings;
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

        // 必须先 super.onCreate（它会初始化 bridge + WebView + 按 capacitor.config 加载 URL）
        super.onCreate(savedInstanceState);

        // 暮色 2026-08-27 缩放方案回退（第 1 项）：不要捏合缩放了
        //   - setSupportZoom(false)：关掉缩放手势
        //   - setInitialScale(90)：初始 90% 缩放（先用 90% 试，太大太小再调）
        //   - useWideViewPort + loadWithOverviewMode：按页面 viewport 宽度自动适配屏幕
        WebSettings webSettings = this.bridge.getWebView().getSettings();
        webSettings.setSupportZoom(false);
        webSettings.setInitialScale(90);
        webSettings.setUseWideViewPort(true);
        webSettings.setLoadWithOverviewMode(true);

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
