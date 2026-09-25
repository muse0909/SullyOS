package com.aetheros.simulator

import android.content.Context
import android.util.Base64
import com.google.crypto.tink.apps.webpush.WebPushHybridDecrypt
import com.google.crypto.tink.subtle.EllipticCurves
import org.unifiedpush.android.connector.data.PublicKeySet
import org.unifiedpush.android.connector.keys.KeyManager
import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.KeyPair
import java.security.SecureRandom
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECParameterSpec
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import java.security.spec.PKCS8EncodedKeySpec

/**
 * 暮色 2026-09-25 20:02 拍板：自定义 KeyManager 让 UnifiedPush SDK 用 app 端的 VAPID key pair
 * + per-instance auth secret 解密推送。
 *
 * 默认 KeyManager（DefaultKeyManager / WebPushKeysEntries23）独立生成 ECDH key pair 存 AndroidKeyStore。
 * 推送实际加密用的是 ntfy distributor 拿到的 vapid 公钥（=我们 app 端的 VAPID 公钥）+ distributor
 * 自己生成的 auth；默认 KeyManager 用的 ECDH key pair 跟这俩都不对应 → decrypt 永远失败 →
 * PushMessage.decrypted=false。
 *
 * 这个类复用 SDK 的 WebPushHybridDecrypt（Google Tink）做 RFC 8291 解密，加密层原封不动；
 * 只把密钥来源换成 app 端 VAPID_PREFS 里已经持久化的 key pair + 新加的 per-instance auth secret。
 *
 * VAPID 公钥 = ECDH 公钥（P-256 曲线，SEC1 uncompressed 65 字节 base64url 编码），
 * auth = 16-byte 随机 secret 走 base64(NO_PADDING) 编码（跟 SDK 默认 WebPushKeys 一致）。
 */
class AmsgKeyManager(private val context: Context) : KeyManager {

    companion object {
        const val AUTH_PREFS = "unifiedpush_webpush_auth_v1"
        private const val AUTH_KEY_FMT = "%s/auth_b64"
        private const val AUTH_BYTES_LEN = 16

        // VAPID/订阅密钥 = NIST P-256 curve。跟 SDK 默认 WebPushKeysEntries23 用的曲线一致。
        private val curveSpec: ECParameterSpec =
            EllipticCurves.getCurveSpec(EllipticCurves.CurveType.NIST_P256)
    }

    private val vapidSp by lazy {
        context.getSharedPreferences(AmsgUnifiedPushPlugin.VAPID_PREFS, Context.MODE_PRIVATE)
    }
    private val authSp by lazy {
        context.getSharedPreferences(AUTH_PREFS, Context.MODE_PRIVATE)
    }

    private fun authKey(instance: String): String = String.format(AUTH_KEY_FMT, instance)

    /** 读 VAPID_PREFS 里的 key pair + AUTH_PREFS 里的 auth secret；任一缺失返回 null。 */
    private fun loadKeys(instance: String): Pair<ByteArray, KeyPair>? {
        val pubB64u = vapidSp.getString(AmsgUnifiedPushPlugin.VAPID_PUBLIC_KEY, null) ?: return null
        val privPkcs8B64 = vapidSp.getString(AmsgUnifiedPushPlugin.VAPID_PRIVATE_KEY, null) ?: return null
        val authB64 = authSp.getString(authKey(instance), null) ?: return null

        // 公钥：SEC1 uncompressed + base64url（VAPID 标准）
        val pub: ECPublicKey = unserializePubKey(pubB64u)
        // 私钥：PKCS#8 + base64(NO_WRAP)（AmsgUnifiedPushPlugin.ensureVapidKey 写入格式）
        val privBytes = Base64.decode(privPkcs8B64, Base64.NO_WRAP)
        val priv = KeyFactory.getInstance("EC")
            .generatePrivate(PKCS8EncodedKeySpec(privBytes)) as ECPrivateKey

        // auth：base64(NO_PADDING)（跟 SDK 默认 WebPushKeys 一致）
        val auth = Base64.decode(authB64, Base64.NO_PADDING)
        if (auth.size != AUTH_BYTES_LEN) return null

        return auth to KeyPair(pub, priv)
    }

    /** 复用 Google Tink WebPushHybridDecrypt 做 RFC 8291 解密（加密层原封不动）。 */
    override fun decrypt(instance: String, sealed: ByteArray): ByteArray? {
        val (auth, keyPair) = loadKeys(instance) ?: return null
        return try {
            WebPushHybridDecrypt.Builder()
                .withAuthSecret(auth)
                .withRecipientPublicKey(keyPair.public as ECPublicKey)
                .withRecipientPrivateKey(keyPair.private as ECPrivateKey)
                .build()
                .decrypt(sealed, null)
        } catch (e: GeneralSecurityException) {
            null
        }
    }

    /** 确保 VAPID key pair 存在 + 生成 16-byte auth secret（每个 instance 一份）。 */
    override fun generate(instance: String) {
        AmsgUnifiedPushPlugin.ensureVapidKey(context)
        if (authSp.getString(authKey(instance), null) == null) {
            val auth = ByteArray(AUTH_BYTES_LEN)
            SecureRandom().nextBytes(auth)
            authSp.edit().putString(authKey(instance), b64Encode(auth)).apply()
        }
    }

    /**
     * 推送加密时 distributor 用这套 PublicKeySet：
     * pubKey = 我们 VAPID 公钥（base64url SEC1 uncompressed）
     * auth = 我们生成的 16-byte secret（base64 NO_PADDING）
     */
    override fun getPublicKeySet(instance: String): PublicKeySet {
        val (auth, keyPair) = loadKeys(instance)
            ?: throw IllegalStateException("VAPID key pair 或 auth secret 未生成，请先调 generate(instance)")
        return PublicKeySet(
            pubKey = serializePubKey(keyPair.public as ECPublicKey),
            auth = b64Encode(auth)
        )
    }

    override fun exists(instance: String): Boolean {
        val hasKeys = vapidSp.contains(AmsgUnifiedPushPlugin.VAPID_PUBLIC_KEY) &&
                      vapidSp.contains(AmsgUnifiedPushPlugin.VAPID_PRIVATE_KEY)
        return hasKeys && authSp.contains(authKey(instance))
    }

    /** 删 auth secret。VAPID key pair 保留（其他模块可能还用，比如给前端比对公钥）。 */
    override fun delete(instance: String) {
        authSp.edit().remove(authKey(instance)).apply()
    }

    // ----- utils（自实现，避免 import SDK 内部 Utility） -----

    /** base64(NO_PADDING) 编码，跟 SDK UtilsKt.b64encode 一致。 */
    private fun b64Encode(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.NO_PADDING)

    /** SEC1 uncompressed P-256 公钥 → ECPublicKey（跟 SDK UtilsKt.deserializePubKey 一致）。 */
    private fun unserializePubKey(b64u: String): ECPublicKey {
        val sec1 = base64UrlDecode(b64u)
        val point = EllipticCurves.pointDecode(
            EllipticCurves.CurveType.NIST_P256,
            EllipticCurves.PointFormatType.UNCOMPRESSED,
            sec1
        )
        val spec = ECPublicKeySpec(point, curveSpec)
        return KeyFactory.getInstance("EC").generatePublic(spec) as ECPublicKey
    }

    /** ECPublicKey → SEC1 uncompressed base64url（跟 SDK UtilsKt.serialize 一致）。 */
    private fun serializePubKey(pub: ECPublicKey): String {
        val sec1 = EllipticCurves.pointEncode(
            EllipticCurves.CurveType.NIST_P256,
            EllipticCurves.PointFormatType.UNCOMPRESSED,
            pub.w
        )
        return base64UrlEncode(sec1)
    }

    /** base64url → bytes。 */
    private fun base64UrlDecode(s: String): ByteArray {
        val std = s.replace('-', '+').replace('_', '/')
        val padded = std + "=".repeat((4 - std.length % 4) % 4)
        return Base64.decode(padded, Base64.DEFAULT)
    }

    /** bytes → base64url（NO_PADDING）。 */
    private fun base64UrlEncode(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}