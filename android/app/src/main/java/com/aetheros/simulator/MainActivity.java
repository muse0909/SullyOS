package com.aetheros.simulator;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 暮色 2026-08-26 角色查手机 P0：注册 PhoneUsagePlugin
        registerPlugin(PhoneUsagePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
