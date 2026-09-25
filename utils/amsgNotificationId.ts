/**
 * 暮色 2026-09-25：A3 重复通知去重 —
 *   跟 android/.../UnifiedPushService.kt:97 notificationIdHash 用同一套算法，
 *   让 JS 端 Capacitor LocalNotifications 弹的 id 跟 Kotlin 端 NotificationManager.notify 的 id
 *   在同 messageId 下保持一致 → 同 id 在 Android 系统里**覆盖** 旧的，不会再叠加第二条。
 *
 *   镜像 Kotlin 实现：
 *     1. Kotlin `String.hashCode()` —— Java 实现是 `h = 31 * h + value[i]` 累计
 *     2. Kotlin `Math.abs(Int)` —— Java 实现是 `if (value < 0) -value else value`
 *        边界 Int.MIN_VALUE（-2147483648）取负会回到 -2147483648（int 溢出回负）
 *     3. messageId 为空时退回 charId
 *
 *   注意：JS `Math.abs` 返回 Number（double），`| 0` 强截回 int32 → 跟 Kotlin 一致
 *   （边界 Int.MIN_VALUE 时 JS 也回负，覆盖范围严格相等）。
 */

/** Kotlin `String.hashCode()` 镜像 —— 31 * h + charCodeAt(i) 累计，最后 `| 0` 截 int32。 */
export function kotlinStringHashCode(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i += 1) {
        h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h | 0;
}

/**
 * 计算主动消息通知 id。同一 (messageId, charId) 在两台设备/两套语言里算出的 id 完全一致，
 * Android NotificationManager / Capacitor LocalNotifications 都按 id 覆盖同一条通知。
 */
export function proactiveNotificationId(messageId: string, charId: string): number {
    const key = messageId ? messageId : charId;
    return Math.abs(kotlinStringHashCode(key)) | 0;
}