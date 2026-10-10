/**
 * 「邀请一起看」这个开关（10-07 02:42，暮色定的）。
 *
 * ## 为什么要有这个开关
 *
 * 剧场这个产品的本质是**两个人一起看**。但短剧也是**你自己要追的剧** ——
 * 你想安静看完一集的时候，身旁那个人一直盯着画面盯着剧情，很烦。
 *
 * 所以权交给你：
 *   - **没邀请** → 角色看不到画面。你安静追剧，他就在旁边待着。
 *   - **邀请了** → 角色才开始看。之后你问他什么他都答得上来。
 *
 * 默认是**没邀请** —— 安静追剧是更常见的状态，要一起看时再点一下。
 * （暮色原话：「不邀请就是我自己看，邀请了角色才能看到画面」）
 *
 * ## 为什么存 localStorage 而不是角色配置
 * 这是**这次看剧的状态**，不是角色的一部分。跟着角色存会跟着备份到处跑，
 * 下次打开剧场莫名就变成「他在看」了。
 * 换个角色就该换一个状态，所以 key 里带角色 id。
 *
 * ## 为什么不用 useState 存着就行
 * 因为要在**抽帧循环里读**，而那个循环在组件外面（见 useTheaterLive）。
 * 用 ref 的话切角色时容易漏同步，写进 localStorage 反而天然一致 ——
 * 反正这个值本来就要跨会话记着。
 */

const KEY = 'theater_invited';

function keyOf(charId: string) {
  return `${KEY}_${charId || 'none'}`;
}

/** 这个角色现在有没有被邀请一起看 */
export function isInvited(charId: string): boolean {
  try {
    return localStorage.getItem(keyOf(charId)) === '1';
  } catch {
    return false;
  }
}

export function setInvited(charId: string, v: boolean) {
  try {
    if (v) localStorage.setItem(keyOf(charId), '1');
    else localStorage.removeItem(keyOf(charId));
  } catch { /* 无所谓，最多是下一集又变回没邀请 */ }
}