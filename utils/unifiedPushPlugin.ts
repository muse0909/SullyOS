import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export interface UnifiedPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  distributor: string;
  temporary: boolean;
  vapidPublicKey: string;
}

export interface UnifiedPushStatus {
  native: boolean;
  distributors: string[];
  distributor: string | null;
  subscription: UnifiedPushSubscription | null;
  lastError: string | null;
  permission: 'granted' | 'denied' | 'prompt';
}

export interface UnifiedPushStoredMessage {
  payload: string;
  receivedAt: number;
}

interface UnifiedPushNativePlugin {
  getStatus(): Promise<Omit<UnifiedPushStatus, 'permission'>>;
  register(options: { vapidPublicKey: string }): Promise<{ pending: boolean }>;
  unregister(): Promise<void>;
  drainPendingPushes(): Promise<{ messages: UnifiedPushStoredMessage[]; launchPayload?: string }>;
  addListener(
    eventName: 'pushReceived' | 'notificationTapped' | 'registrationChanged',
    listener: (event: any) => void,
  ): Promise<PluginListenerHandle>;
}

const NativeUnifiedPush = registerPlugin<UnifiedPushNativePlugin>('AmsgUnifiedPush');

export const isUnifiedPushPlatform = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const readPermission = async (): Promise<UnifiedPushStatus['permission']> => {
  const result = await LocalNotifications.checkPermissions();
  if (result.display === 'granted') return 'granted';
  if (result.display === 'denied') return 'denied';
  return 'prompt';
};

export const getUnifiedPushStatus = async (): Promise<UnifiedPushStatus> => {
  if (!isUnifiedPushPlatform()) {
    return {
      native: false,
      distributors: [],
      distributor: null,
      subscription: null,
      lastError: null,
      permission: 'denied',
    };
  }

  const [status, permission] = await Promise.all([
    NativeUnifiedPush.getStatus(),
    readPermission(),
  ]);
  return { ...status, permission };
};

const requireNotificationPermission = async (): Promise<void> => {
  const current = await LocalNotifications.checkPermissions();
  const result = current.display === 'prompt'
    ? await LocalNotifications.requestPermissions()
    : current;
  if (result.display !== 'granted') {
    throw new Error('通知权限未授予，UnifiedPush 收到消息后无法显示系统通知。');
  }
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 获取一条标准 Web Push 订阅，可直接交给 AMSG Worker。 */
export const ensureUnifiedPushSubscription = async (
  vapidPublicKey: string,
): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } }> => {
  if (!isUnifiedPushPlatform()) throw new Error('UnifiedPush 仅用于 Android 原生 App。');
  await requireNotificationPermission();

  const before = await NativeUnifiedPush.getStatus();
  if (!before.distributor && before.distributors.length === 0) {
    throw new Error('没有检测到 UnifiedPush 服务。请先安装并打开 ntfy 的无 Firebase 版本，允许它后台运行后再试。');
  }

  await NativeUnifiedPush.register({ vapidPublicKey });
  // 暮色 2026-09-19 14:18 修：60 次 250ms = 15s 太短。
  //   SDK register() 后链路: 创建 endpoint(网络) → 通知 distributor → distributor 通知 SDK →
  //   SDK bind 我们的 PushService → onNewEndpoint 写 SP. 这一路跨进程跨网络,
  //   distributor 处理慢 / bind service 启动慢都可能让 15s 不够。
  //   提到 180 次 250ms = 45s. 但加了 lastError 早返回, 真实失败不会等满。
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const status = await NativeUnifiedPush.getStatus();
    const subscription = status.subscription;
    // 麦麦 2026-09-23 21:07 修：去掉 subscription.keys?.auth 判断。
    //   UnifiedPush 协议不需要 RFC8291 的客户端 auth 字段，Android 端 AmsgUnifiedPushPlugin.kt:173
    //   故意把 auth 写成空字符串保接口形状，但空串在 JS 里 falsy → 条件永远不通过 → 45s 假超时。
    //   logcat 验证：onNewEndpoint 21:04:11.913 已写 endpoint 完成，前端就是读不到。
    //   其他 3 项保留(endpoint 有 / p256dh 有 / vapidPublicKey 跟 worker 公钥匹配)。
    if (
      subscription?.endpoint
      && subscription.keys?.p256dh
      && subscription.vapidPublicKey === vapidPublicKey
    ) {
      return { endpoint: subscription.endpoint, keys: subscription.keys };
    }
    if (status.lastError) {
      // UnifiedPushService.onNewEndpoint 在 endpoint 为空 / 写失败时会写 lastError,
      // 这里直接抛带原因的错, 比超时报错更具体。
      throw new Error(`UnifiedPush 注册失败：${status.lastError}`);
    }
    await delay(250);
  }

  throw new Error('UnifiedPush 注册超时（45s）。请确认 ntfy 已打开并允许它在后台运行。');
};

export const readUnifiedPushSubscription = async () =>
  (await getUnifiedPushStatus()).subscription;

export const drainUnifiedPushMessages = () => NativeUnifiedPush.drainPendingPushes();

export const addUnifiedPushListener = (
  eventName: 'pushReceived' | 'notificationTapped' | 'registrationChanged',
  listener: (event: any) => void,
) => NativeUnifiedPush.addListener(eventName, listener);
