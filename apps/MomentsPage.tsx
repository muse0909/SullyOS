// MomentsPage — 朋友圈主页（v3 修复版）
// 修复 v2 反馈：
//   1. 签名靠右对齐（头像左边）
//   2. 头像去掉白圈底
//   3. 签名下面的浅灰分割线去掉
//   4. 名字在封面图上（跟头像并列，卡封面图底边上面一点点）
//   5. 签名点击/长按不进编辑 → 之前是 z-index 被头像覆盖；现在签名独立行 + 留 padding-right
//   6. 连发被吞 + 退出去再回来不见 → **localStorage quota 超出静默失败**（带图 dataURL 太大）
//      修复：图片 canvas 压缩到 1080px / jpeg 0.7 + saveAllPosts 失败 addToast 提示

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CaretLeft, Camera, X, Heart, ChatCircleDots, Gear, PaperPlaneTilt } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import {
  MomentPost,
  getAllPosts,
  addPost,
  getSignature,
  setSignature,
  getCoverImage,
  setCoverImage,
  saveAllPosts,
  genPostId,
  getSettings as getMomentsSettings,
  likePostAsUser,
  unlikePostAsUser,
  commentPostAsUser,
} from '../utils/momentsStorage';
import { triggerAIReaction, triggerAICommentReply, commentPostAsChar } from '../utils/momentsAI';
import { DB } from '../utils/db';
import MomentsSettingsPage from './MomentsSettingsPage';

// 压缩图片到 max 1080px + jpeg 0.7 —— 避免 localStorage quota 超出
async function compressImage(dataUrl: string, maxDim = 1080, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl); // 兜底：原图
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        resolve(dataUrl); // 兜底
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

const MomentsPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  // 暮色 2026-07-03 修复：补 destructure `activeCharacterId` 和 `apiConfig`
  // 之前 line 225-227 引用了这两个变量但 useOS() 没取出来 → ReferenceError
  // 整个 AI trigger 流程直接挂了，toast "已发表" 之后报错
  // 表现为：toast 弹了但 AI 没反应（trigger 流程没启动）
  const { theme, userProfile, characters, addToast, activeCharacterId, apiConfig } = useOS();
  const [posts, setPosts] = useState<MomentPost[]>(() => {
    try { return getAllPosts(); } catch { return []; }
  });
  const [signature, setSigState] = useState(getSignature());
  const [signatureDraft, setSignatureDraft] = useState('');
  const [coverImage, setCoverImageState] = useState<string | null>(getCoverImage());
  const [editingSignature, setEditingSignature] = useState(false);
  const [showPublisher, setShowPublisher] = useState(false);
  const [showSettings, setShowSettings] = useState(false); // 暮色 2026-07-04：齿轮入口放到工具栏相机左边
  const [showCoverOptions, setShowCoverOptions] = useState(false);
  const [selectedPost, setSelectedPost] = useState<MomentPost | null>(null);
  const [imageModal, setImageModal] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<number | null>(null);

  // 刷新数据
  const refreshPosts = useCallback(() => {
    try {
      const all = getAllPosts();
      setPosts(all);
      setSigState(getSignature());
      setCoverImageState(getCoverImage());
    } catch (e) {
      console.error('[moments] refresh failed', e);
    }
  }, []);

  // 页面重新可见时刷新（退出去再回来）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshPosts();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    // mount 时强制刷新（兜底）
    refreshPosts();
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshPosts]);

  // 头像形状
  const avatarShape = theme.chatAvatarShape || 'circle';
  const avatarClass =
    avatarShape === 'circle' ? 'rounded-full' :
    avatarShape === 'rounded' ? 'rounded-2xl' :
    'rounded-md';

  // 渲染用户头像元素（无白圈底）
  const renderUserAvatar = (size: 'sm' | 'md' | 'lg' = 'md') => {
    const sizeClass = size === 'sm' ? 'w-10 h-10' : size === 'lg' ? 'w-16 h-16' : 'w-12 h-12';
    if (userProfile.avatar) {
      return (
        <img
          src={userProfile.avatar}
          alt={userProfile.name}
          className={`${sizeClass} ${avatarClass} border-2 border-white object-cover bg-slate-100`}
        />
      );
    }
    return (
      <div
        className={`${sizeClass} ${avatarClass} border-2 border-white flex items-center justify-center text-white font-bold shadow-sm`}
        style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}
      >
        {(userProfile.name || '?').slice(0, 1)}
      </div>
    );
  };

  // 渲染角色头像
  const renderCharAvatar = (charId: string | undefined, name: string, charColor: number | undefined, size: 'sm' | 'md' = 'sm') => {
    const char = characters.find((c) => c.id === charId);
    const sizeClass = size === 'sm' ? 'w-10 h-10' : 'w-12 h-12';
    if (char?.avatar) {
      return (
        <img
          src={char.avatar}
          alt={name}
          className={`${sizeClass} ${avatarClass} object-cover bg-slate-100`}
        />
      );
    }
    const bg = typeof charColor === 'number' ? `hsl(${charColor}, 70%, 65%)` : 'linear-gradient(135deg, #a78bfa, #8b5cf6)';
    return (
      <div
        className={`${sizeClass} ${avatarClass} flex items-center justify-center text-white font-bold text-sm`}
        style={{ background: bg }}
      >
        {name.slice(0, 1)}
      </div>
    );
  };

  // 封面图长按
  const handleCoverPointerDown = () => {
    longPressTimerRef.current = window.setTimeout(() => {
      setShowCoverOptions(true);
    }, 600);
  };
  const handleCoverPointerUp = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  const handleCoverFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      addToast('图片太大（>5MB），请压缩后再试', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCoverImage(dataUrl);
      setCoverImageState(dataUrl);
      addToast('封面图已更新', 'success');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const handleResetCover = () => {
    setCoverImage(null);
    setCoverImageState(null);
    setShowCoverOptions(false);
    addToast('已恢复默认封面', 'success');
  };

  // 签名保存（暮色 2026-07-03 改：点签名直接 inline 编辑，不进编辑器）
  // 触发：blur / Enter（保存）/ Escape（取消）
  const handleSignatureSave = () => {
    const text = signatureDraft.trim();
    setSignature(text);
    setSigState(text);
    setEditingSignature(false);
    if (text) addToast('签名已更新', 'success');
  };
  const handleSignatureCancel = () => {
    setEditingSignature(false);
  };

  // 发布朋友圈（带图片压缩 + quota 错误提示 + 暮色 2026-07-03 通知 AI）
  // 暮色 2026-07-03 修正：发完朋友圈立即触发 AI 流程（1 次 API），不等聊天下一轮
  // 流程：AI 点赞 + AI 评论 + AI 决定是否主动发消息
  const handlePublish = async (text: string, images: string[]) => {
    if (!text.trim() && images.length === 0) return;

    addToast('正在处理图片...', 'info');
    const compressed = await Promise.all(images.map((img) => compressImage(img)));

    const newPost: MomentPost = {
      id: genPostId(),
      authorType: 'user',
      content: text,
      images: compressed,
      createdAt: Date.now(),
      likes: [],
      comments: [],
    };

    // 先本地更新 state
    const all = [newPost, ...posts];
    setPosts(all);
    setShowPublisher(false);

    // 异步写 localStorage
    try {
      saveAllPosts(all);
      addToast('已发表', 'success');
      // 暮色 2026-07-03：发完朋友圈立即触发 AI（不等聊天下一轮）
      const settings = getMomentsSettings();
      if (settings.notifyAIOnUserPost && activeCharacterId && characters.length > 0) {
        const char = characters.find((c) => c.id === activeCharacterId);
        if (char && apiConfig.baseUrl && apiConfig.apiKey) {
          addToast('已通知 AI', 'info', 2000);
          // fire-and-forget：异步跑 trigger 流程
          triggerAIReaction(
            char,
            newPost,
            settings,
            apiConfig,
            {
              userName: userProfile.name || '我',
              userPersona: userProfile.persona,
              memory: char.memory,
            },
            // 主动消息回调：写进 IndexedDB + 通知 Chat
            (message: string) => {
              // 1) 持久化
              DB.saveMessage({
                charId: char.id,
                role: 'assistant',
                type: 'text',
                content: message,
                timestamp: Date.now(),
                metadata: { source: 'moments_trigger' }, // 标记来源，方便后续追踪
              }).then(() => {
                // 2) 通知 Chat（如果在 mount）让它立即 prepend
                window.dispatchEvent(new CustomEvent('sullyos:direct-ai-message', {
                  detail: { charId: char.id, content: message, timestamp: Date.now() },
                }));
                addToast(`${char.name} 主动发来了一条消息`, 'info', 3000);
              }).catch((e) => {
                console.warn('[moments] save direct message failed', e);
              });
            }
          ).then((result) => {
            // 触发完后刷新本地 posts state（让 AI 点赞/评论立刻可见）
            const updated = getAllPosts();
            setPosts(updated);
            if (result.comment) {
              addToast(`${char.name} 评论了你的朋友圈`, 'success', 2500);
            }
            if (result.liked) {
              addToast(`${char.name} 赞了你的朋友圈`, 'success', 2000);
            }
          }).catch((e) => {
            console.warn('[moments] trigger failed', e);
          });
        }
      }
    } catch (e: any) {
      // quota 超出：撤回最新一条
      if (e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '')) {
        addToast('存储空间已满，已自动撤回该条动态。请删除一些旧动态', 'error');
        const fallback = getAllPosts();
        setPosts(fallback);
      } else {
        addToast('保存失败：' + (e?.message || '未知错误'), 'error');
      }
    }
  };

  // 暮色 2026-07-12：用户点赞/取消点赞朋友圈
  const handleToggleLike = useCallback((postId: string) => {
    const all = getAllPosts();
    const post = all.find((p) => p.id === postId);
    if (!post) return;
    const alreadyLiked = post.likes.some((l) => l.authorType === 'user');
    if (alreadyLiked) {
      unlikePostAsUser(postId);
    } else {
      likePostAsUser(postId);
    }
    setPosts(getAllPosts());
  }, []);

  // 暮色 2026-07-12：用户评论/回复（replyTo 是另一条 comment.id）
  // 写完 storage 后：
  //  - 刷新 UI
  //  - 如果评论的是角色 post → 调 triggerAICommentReply 让 AI 决定是否回复
  const handleSubmitComment = useCallback(async (postId: string, content: string, replyTo?: string) => {
    if (!content.trim()) return;
    const updated = commentPostAsUser(postId, content.trim(), replyTo);
    if (!updated) {
      addToast('评论失败：找不到动态', 'error');
      return;
    }
    setPosts(getAllPosts());
    addToast(replyTo ? '已回复' : '已评论', 'success', 1500);

    // 触发 AI 决定是否回复（仅当评论角色 post）
    if (updated.authorType === 'char' && updated.charId && activeCharacterId && apiConfig.baseUrl && apiConfig.apiKey) {
      const char = characters.find((c) => c.id === updated.charId);
      if (char && char.id === activeCharacterId) {
        // fire-and-forget
        (async () => {
          try {
            const decision = await triggerAICommentReply(
              char,
              updated,
              content.trim(),
              replyTo,
              apiConfig,
              {
                userName: userProfile?.name || '我',
                userPersona: userProfile?.persona,
                memory: char.memory || undefined,
              }
            );
            if (decision?.replied && decision.comment) {
              // 写 AI 回复评论
              commentPostAsChar(postId, char.id, decision.comment);
              setPosts(getAllPosts());
              addToast(`${char.name} 回复了你的评论`, 'info', 2500);
            }
          } catch (e) {
            console.warn('[moments] AI comment reply failed', e);
          }
        })();
      }
    }
  }, [characters, activeCharacterId, apiConfig, userProfile, addToast]);

  return (
    <div className="absolute inset-0 flex flex-col bg-[#ededed] overflow-hidden">
      {/* 顶部工具栏（暮色 2026-07-04：齿轮入口从 DiscoverPage 迁到相机左边） */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-2 py-2 pointer-events-none">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-black/30 backdrop-blur flex items-center justify-center text-white pointer-events-auto active:scale-95 transition-transform"
          aria-label="返回"
        >
          <CaretLeft size={20} weight="bold" />
        </button>
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button
            onClick={() => setShowSettings(true)}
            className="w-9 h-9 rounded-full bg-black/30 backdrop-blur flex items-center justify-center text-white active:scale-95 transition-transform"
            aria-label="朋友圈设置"
          >
            <Gear size={18} weight="bold" />
          </button>
          <button
            className="w-9 h-9 rounded-full bg-black/30 backdrop-blur flex items-center justify-center text-white active:scale-95 transition-transform"
            aria-label="发表朋友圈"
            onClick={() => setShowPublisher(true)}
          >
            <Camera size={18} weight="bold" />
          </button>
        </div>
      </div>

      {/* 可滚动主体 */}
      <div className="flex-1 overflow-y-auto">
        {/* 封面图 240px */}
        <div
          className="relative"
          style={{
            height: 240,
            background: coverImage
              ? undefined
              : 'linear-gradient(180deg, #5d4037 0%, #8d6e63 30%, #d7a96e 60%, #f4e4bc 100%)',
          }}
          onPointerDown={handleCoverPointerDown}
          onPointerUp={handleCoverPointerUp}
          onPointerLeave={handleCoverPointerUp}
        >
          {coverImage && (
            <img src={coverImage} alt="封面" className="absolute inset-0 w-full h-full object-cover" />
          )}

          {/* 名字 — 封面图上、头像左边（卡封面图底边上面一点） */}
          <div className="absolute z-10" style={{ bottom: 12, right: 80 }}>
            <span className="text-white text-base font-bold drop-shadow-md">{userProfile.name}</span>
          </div>

          {/* 头像 — 封面图右下角（无白圈底） */}
          <div className="absolute z-10" style={{ bottom: 8, right: 12 }}>
            {renderUserAvatar('lg')}
          </div>
        </div>

        {/* 签名 — 单独白底行，靠右对齐（暮色 2026-07-03 改：inline input 编辑，点直接改，不进编辑器） */}
        <div className="bg-white relative z-10">
          {editingSignature ? (
            <input
              type="text"
              autoFocus
              value={signatureDraft}
              onChange={(e) => setSignatureDraft(e.target.value)}
              onBlur={handleSignatureSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleSignatureSave(); }
                if (e.key === 'Escape') { e.preventDefault(); handleSignatureCancel(); }
              }}
              maxLength={50}
              placeholder="点此添加签名..."
              className="w-full px-4 py-3 pr-4 text-right bg-slate-50 text-[13px] text-slate-700 leading-snug focus:outline-none focus:bg-white transition-colors placeholder:text-slate-300 touch-manipulation"
              style={{ touchAction: 'manipulation' }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setSignatureDraft(signature);
                setEditingSignature(true);
              }}
              className="w-full px-4 py-3 pr-4 text-right hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer select-none touch-manipulation"
              style={{ touchAction: 'manipulation' }}
            >
              <span className="text-[13px] text-slate-500 leading-snug pointer-events-none">
                {signature || '点此添加签名...'}
              </span>
            </button>
          )}
        </div>

        {/* 动态列表（无 border-t 分割线） */}
        <div className="bg-white min-h-[200px]">
          {posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Camera size={36} weight="regular" className="mb-3 opacity-50" />
              <div className="text-sm">还没有动态</div>
              <div className="text-[11px] mt-1">点右上角相机发一条吧</div>
            </div>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                avatarClass={avatarClass}
                onOpenDetail={() => setSelectedPost(post)}
                onOpenImage={(src) => setImageModal(src)}
                onToggleLike={handleToggleLike}
                onSubmitComment={handleSubmitComment}
                renderCharAvatar={renderCharAvatar}
              />
            ))
          )}
        </div>
      </div>

      {/* 隐藏的 file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleCoverFileChange}
      />

      {/* 签名编辑器（暮色 2026-07-03 改：inline input 直接编辑，不弹编辑器） */}

      {/* 封面图选项 modal（长按触发） */}
      {showCoverOptions && (
        <div
          className="absolute inset-0 z-30 bg-black/40 flex items-end"
          onClick={() => setShowCoverOptions(false)}
        >
          <div className="bg-white w-full rounded-t-3xl p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-xs text-slate-400 mb-2 py-1">封面图</div>
            <button
              onClick={() => { fileInputRef.current?.click(); setShowCoverOptions(false); }}
              className="w-full py-3.5 bg-slate-100 rounded-2xl text-sm font-medium text-slate-700 active:scale-95 transition-transform"
            >
              换封面图
            </button>
            <button
              onClick={handleResetCover}
              className="w-full py-3.5 bg-slate-100 rounded-2xl text-sm font-medium text-slate-700 active:scale-95 transition-transform"
            >
              恢复默认
            </button>
            <button
              onClick={() => setShowCoverOptions(false)}
              className="w-full py-3.5 text-sm text-slate-500 active:scale-95 transition-transform"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 极简发布器 */}
      {showPublisher && (
        <SimplePublisher
          onClose={() => setShowPublisher(false)}
          onPublish={handlePublish}
        />
      )}

      {/* 朋友圈设置（暮色 2026-07-04：从 DiscoverPage 迁到这里，齿轮按钮触发） */}
      {showSettings && (
        <MomentsSettingsPage onBack={() => setShowSettings(false)} />
      )}

      {/* 动态详情 modal */}
      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onOpenImage={(src) => setImageModal(src)}
          avatarClass={avatarClass}
          onToggleLike={handleToggleLike}
          onSubmitComment={handleSubmitComment}
          renderCharAvatar={renderCharAvatar}
        />
      )}

      {/* 图片大图查看 */}
      {imageModal && (
        <ImageViewer src={imageModal} onClose={() => setImageModal(null)} />
      )}
    </div>
  );
};

// === 极简发布器 ===
const SimplePublisher: React.FC<{
  onClose: () => void;
  onPublish: (text: string, images: string[]) => void;
}> = ({ onClose, onPublish }) => {
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useOS();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      addToast('图片太大（>5MB）', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!text.trim() && !image) return;
    setSubmitting(true);
    try {
      await onPublish(text, image ? [image] : []);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <button onClick={onClose} disabled={submitting} className="text-sm text-slate-500 disabled:opacity-50">取消</button>
        <h2 className="text-sm font-semibold text-slate-800">发表朋友圈</h2>
        <button
          onClick={handleSubmit}
          disabled={(!text.trim() && !image) || submitting}
          className="px-4 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded-full disabled:opacity-40"
        >
          {submitting ? '发布中' : '发表'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="这一刻的想法..."
          className="w-full min-h-[120px] bg-transparent text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none leading-relaxed"
        />
        {image && (
          <div className="relative mt-3 inline-block">
            <img src={image} alt="" className="w-32 h-32 object-cover rounded-lg" />
            <button
              onClick={() => setImage(null)}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        )}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="mt-4 w-20 h-20 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 hover:bg-slate-50"
        >
          +
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
};

// === 单条 post 卡片 ===
const PostCard: React.FC<{
  post: MomentPost;
  avatarClass: string;
  onOpenDetail: () => void;
  onOpenImage: (src: string) => void;
  onToggleLike: (postId: string) => void;
  onSubmitComment: (postId: string, content: string, replyTo?: string) => void;
  renderCharAvatar: (charId: string | undefined, name: string, charColor: number | undefined, size?: 'sm' | 'md') => React.ReactNode;
}> = ({ post, avatarClass, onOpenDetail, onOpenImage, onToggleLike, onSubmitComment, renderCharAvatar }) => {
  const { characters, userProfile } = useOS();
  const authorChar = post.authorType === 'char' ? characters.find((c) => c.id === post.charId) : null;
  const authorName = post.authorType === 'user' ? userProfile.name : authorChar?.name || 'AI';
  const authorColor = post.authorType === 'user' ? undefined : authorChar?.themeColor;

  // 暮色 2026-07-12：评论输入框（仿微信） + 长按进详情
  const [commenting, setCommenting] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState<{ id: string; name: string } | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  // 长按 500ms 进详情
  const handleContentPointerDown = () => {
    longPressTriggeredRef.current = false;
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      longPressTimerRef.current = null;
      onOpenDetail();
    }, 500);
  };
  const handleContentPointerEnd = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  const handleContentClick = () => {
    if (!longPressTriggeredRef.current) onOpenDetail();
  };

  // 打开评论输入框 + 自动 focus（可带 replyTo）
  const openComment = (target?: { id: string; name: string }) => {
    setCommenting(true);
    setCommentDraft('');
    setReplyTarget(target || null);
    // 等 DOM 渲染完再 focus
    setTimeout(() => commentInputRef.current?.focus(), 50);
  };
  const closeComment = () => {
    setCommenting(false);
    setCommentDraft('');
    setReplyTarget(null);
  };
  const handleSend = () => {
    const text = commentDraft.trim();
    if (!text) return;
    onSubmitComment(post.id, text, replyTarget?.id);
    setCommentDraft('');
    setCommenting(false);
    setReplyTarget(null);
  };

  // 暮色 2026-07-12：点评论项 → 弹输入框（带 replyTo）
  const handleCommentItemClick = (c: { id: string; authorType: 'user' | 'char'; charId?: string }) => {
    const name = c.authorType === 'user'
      ? userProfile.name
      : characters.find((x) => x.id === c.charId)?.name || 'AI';
    openComment({ id: c.id, name });
  };

  return (
    <div className="flex gap-3 p-3 border-b border-slate-100 bg-white">
      <div className="shrink-0">
        {post.authorType === 'user' ? (
          userProfile.avatar ? (
            <img
              src={userProfile.avatar}
              alt={authorName}
              className={`w-10 h-10 ${avatarClass} object-cover bg-slate-100`}
            />
          ) : (
            <div
              className={`w-10 h-10 ${avatarClass} flex items-center justify-center text-white font-bold text-sm`}
              style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}
            >
              {authorName.slice(0, 1)}
            </div>
          )
        ) : (
          renderCharAvatar(post.charId, authorName, authorColor, 'sm')
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800">{authorName}</div>
        {/* 长按 500ms 进详情，短按不响应（避免误触）*/}
        <div
          onClick={handleContentClick}
          onPointerDown={handleContentPointerDown}
          onPointerUp={handleContentPointerEnd}
          onPointerLeave={handleContentPointerEnd}
          onPointerCancel={handleContentPointerEnd}
          className="text-left w-full cursor-pointer select-none touch-manipulation"
        >
          <div className="text-sm text-slate-700 mt-1 leading-relaxed whitespace-pre-wrap break-words">{post.content}</div>
        </div>
        {post.images.length > 0 && (
          <div
            className="mt-2 grid gap-1"
            style={{
              gridTemplateColumns: post.images.length === 1 ? '1fr' : 'repeat(3, 1fr)',
              maxWidth: post.images.length === 1 ? 220 : undefined,
            }}
          >
            {post.images.map((img, i) => (
              <button
                key={i}
                onClick={() => onOpenImage(img)}
                className="block active:opacity-80 transition-opacity"
              >
                <img src={img} alt="" className="w-full aspect-square object-cover rounded" />
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between mt-1.5">
          <div className="text-[10px] text-slate-400">{formatTime(post.createdAt)}</div>
          <div className="flex items-center gap-3">
            {/* 暮色 2026-07-12：列表卡片加点赞按钮 */}
            <button
              onClick={() => onToggleLike(post.id)}
              className={`flex items-center gap-1 text-[10px] ${
                post.likes.some((l) => l.authorType === 'user') ? 'text-red-500' : 'text-slate-400 hover:text-slate-600'
              }`}
              aria-label="点赞"
            >
              <Heart
                size={14}
                weight={post.likes.some((l) => l.authorType === 'user') ? 'fill' : 'regular'}
              />
              {post.likes.length > 0 && <span>{post.likes.length}</span>}
            </button>
            {/* 暮色 2026-07-12：评论按钮 → 点开 in-page 输入框（仿微信）*/}
            <button
              onClick={openComment}
              className={`flex items-center gap-1 text-[10px] ${commenting ? 'text-emerald-500' : 'text-slate-400 hover:text-slate-600'}`}
              aria-label="评论"
            >
              <ChatCircleDots size={14} weight={commenting ? 'fill' : 'regular'} />
              {post.comments.length > 0 && <span>{post.comments.length}</span>}
            </button>
          </div>
        </div>

        {/* 暮色 2026-07-12：in-page 评论输入框（仿微信朋友圈：键盘弹起时浮在底部）*/}
        {commenting && (
          <div className="mt-2">
            {replyTarget && (
              <div className="flex items-center justify-between mb-1 px-1">
                <div className="text-[11px] text-slate-500">
                  回复 <span className="font-semibold text-slate-700">@{replyTarget.name}</span>
                </div>
                <button
                  onClick={() => setReplyTarget(null)}
                  className="text-[11px] text-slate-400 px-1"
                >
                  取消回复
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 bg-slate-50 rounded-2xl px-3 py-2">
              <input
                ref={commentInputRef}
                type="text"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeComment();
                  }
                }}
                onBlur={() => {
                  // 失焦且没内容时关闭
                  if (!commentDraft.trim()) {
                    setTimeout(() => closeComment(), 100);
                  }
                }}
                maxLength={200}
                placeholder={replyTarget ? `回复 @${replyTarget.name}` : `评论 ${authorName}...`}
                className="flex-1 bg-transparent text-sm text-slate-700 focus:outline-none placeholder:text-slate-400"
              />
              <button
                onClick={handleSend}
                disabled={!commentDraft.trim()}
                className="text-xs px-2.5 py-1 bg-emerald-500 text-white rounded-full disabled:opacity-40 active:scale-95 transition-transform shrink-0"
              >
                发送
              </button>
              <button
                onClick={closeComment}
                className="text-xs text-slate-400 px-1 shrink-0"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {(post.likes.length > 0 || post.comments.length > 0) && (
          <div className="mt-2 bg-slate-50 rounded-lg p-2 text-xs space-y-1">
            {post.likes.length > 0 && (
              <div className="flex items-center gap-1 text-slate-700">
                <Heart size={12} weight="fill" className="text-red-400 shrink-0" />
                <span className="truncate">
                  {post.likes.map((l) => {
                    if (l.authorType === 'user') return userProfile.name;
                    return characters.find((x) => x.id === l.charId)?.name || 'AI';
                  }).join('、')}
                </span>
              </div>
            )}
            {post.comments.length > 0 && (
              <div className="space-y-0.5 text-slate-700">
                {/* 暮色 2026-07-12：评论项可点击 → 弹输入框回复（嵌套 replyTo）*/}
                {post.comments.slice(0, 2).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleCommentItemClick({ id: c.id, authorType: c.authorType, charId: c.charId })}
                    className="w-full text-left hover:bg-slate-100 active:bg-slate-200/60 rounded px-1 -mx-1 transition-colors cursor-pointer"
                  >
                    <span className="font-semibold text-slate-800">
                      {c.authorType === 'user' ? userProfile.name : (characters.find((x) => x.id === c.charId)?.name || 'AI')}：
                    </span>
                    <span>{c.content}</span>
                  </button>
                ))}
                {post.comments.length > 2 && (
                  <div className="text-slate-400 text-[10px]">共 {post.comments.length} 条评论</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// === 动态详情 modal ===
const PostDetailModal: React.FC<{
  post: MomentPost;
  onClose: () => void;
  onOpenImage: (src: string) => void;
  avatarClass: string;
  onToggleLike: (postId: string) => void;
  onSubmitComment: (postId: string, content: string, replyTo?: string) => void;
  renderCharAvatar: (charId: string | undefined, name: string, charColor: number | undefined, size?: 'sm' | 'md') => React.ReactNode;
}> = ({ post, onClose, onOpenImage, avatarClass, onToggleLike, onSubmitComment, renderCharAvatar }) => {
  const { characters, userProfile } = useOS();
  const authorChar = post.authorType === 'char' ? characters.find((c) => c.id === post.charId) : null;
  const authorName = post.authorType === 'user' ? userProfile.name : authorChar?.name || 'AI';
  const authorColor = post.authorType === 'user' ? undefined : authorChar?.themeColor;

  // 暮色 2026-07-12：评论输入框 state
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isLikedByUser = post.likes.some((l) => l.authorType === 'user');

  const handleSend = () => {
    const text = commentText.trim();
    if (!text) return;
    onSubmitComment(post.id, text, replyTo?.id);
    setCommentText('');
    setReplyTo(null);
  };

  const startReply = (c: { id: string; authorType: 'user' | 'char'; charId?: string }) => {
    const name = c.authorType === 'user'
      ? userProfile.name
      : characters.find((x) => x.id === c.charId)?.name || 'AI';
    setReplyTo({ id: c.id, name });
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const cancelReply = () => {
    setReplyTo(null);
  };

  return (
    <div className="absolute inset-0 z-40 bg-[#ededed] flex flex-col">
      {/* Header：返回 + 标题 + 点赞按钮 */}
      <div className="flex items-center px-4 py-2.5 bg-white border-b border-slate-100 shrink-0">
        <button onClick={onClose} className="text-slate-500 text-lg">‹</button>
        <h2 className="text-sm font-semibold text-slate-800 ml-2 flex-1">动态详情</h2>
        <button
          onClick={() => onToggleLike(post.id)}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors ${
            isLikedByUser ? 'text-red-500 bg-red-50' : 'text-slate-500 hover:bg-slate-100'
          }`}
          aria-label="点赞"
        >
          <Heart size={14} weight={isLikedByUser ? 'fill' : 'regular'} />
          <span>{post.likes.length}</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto pb-20">
        <div className="bg-white p-3 flex gap-2.5">
          <div className="shrink-0">
            {post.authorType === 'user' ? (
              userProfile.avatar ? (
                <img src={userProfile.avatar} alt="" className={`w-10 h-10 ${avatarClass} object-cover bg-slate-100`} />
              ) : (
                <div className={`w-10 h-10 ${avatarClass} flex items-center justify-center text-white font-bold text-sm`} style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}>
                  {authorName.slice(0, 1)}
                </div>
              )
            ) : renderCharAvatar(post.charId, authorName, authorColor, 'sm')}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-800">{authorName}</div>
            <div className="text-sm text-slate-700 mt-1 leading-relaxed whitespace-pre-wrap break-words">{post.content}</div>
            {post.images.length > 0 && (
              <div
                className="mt-2 grid gap-1"
                style={{
                  gridTemplateColumns: post.images.length === 1 ? '1fr' : 'repeat(3, 1fr)',
                  maxWidth: post.images.length === 1 ? 220 : undefined,
                }}
              >
                {post.images.map((img, i) => (
                  <button key={i} onClick={() => onOpenImage(img)} className="block active:opacity-80 transition-opacity">
                    <img src={img} alt="" className="w-full aspect-square object-cover rounded" />
                  </button>
                ))}
              </div>
            )}
            <div className="text-[10px] text-slate-400 mt-1.5">{formatTime(post.createdAt)}</div>
          </div>
        </div>
        <div className="bg-white px-3 pb-3 border-b border-slate-100">
          {post.likes.length > 0 && (
            <div className="bg-slate-50 rounded-lg p-2 text-xs flex items-center gap-1 mb-1.5">
              <Heart size={12} weight="fill" className="text-red-400 shrink-0" />
              <span className="text-slate-700 truncate">
                {post.likes.map((l) => {
                  if (l.authorType === 'user') return userProfile.name;
                  return characters.find((x) => x.id === l.charId)?.name || 'AI';
                }).join('、')}
              </span>
            </div>
          )}
          {post.comments.length > 0 ? (
            <div className="bg-slate-50 rounded-lg p-2 text-xs space-y-1.5">
              {post.comments.map((c) => {
                const commenterName = c.authorType === 'user'
                  ? userProfile.name
                  : characters.find((x) => x.id === c.charId)?.name || 'AI';
                const replyTarget = c.replyTo
                  ? post.comments.find((x) => x.id === c.replyTo)
                  : null;
                const replyTargetName = replyTarget
                  ? (replyTarget.authorType === 'user'
                      ? userProfile.name
                      : characters.find((x) => x.id === replyTarget.charId)?.name || 'AI')
                  : null;
                return (
                  <div key={c.id}>
                    <span className="font-semibold text-slate-800">
                      {commenterName}
                      {replyTargetName && <span className="text-slate-500 font-normal"> 回复 {replyTargetName}</span>}：
                    </span>
                    <span className="text-slate-700">{c.content}</span>
                    {/* 暮色 2026-07-12：评论项加"回复"按钮 */}
                    <button
                      onClick={() => startReply({ id: c.id, authorType: c.authorType, charId: c.charId })}
                      className="ml-2 text-[10px] text-slate-400 hover:text-slate-600"
                    >
                      回复
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-xs text-slate-400 py-3">还没有评论</div>
          )}
        </div>
      </div>

      {/* 暮色 2026-07-12：底部评论输入框（fixed bottom） */}
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-3 py-2 safe-area-bottom">
        {replyTo && (
          <div className="flex items-center justify-between mb-1.5 px-1">
            <div className="text-[11px] text-slate-500">
              回复 <span className="font-semibold text-slate-700">{replyTo.name}</span>
            </div>
            <button onClick={cancelReply} className="text-[11px] text-slate-400">取消</button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={replyTo ? `回复 @${replyTo.name}` : '说点什么...'}
            maxLength={200}
            className="flex-1 px-3 py-2 bg-slate-100 rounded-full text-sm text-slate-700 focus:outline-none focus:bg-slate-200/70 placeholder:text-slate-400"
          />
          <button
            onClick={handleSend}
            disabled={!commentText.trim()}
            className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform shrink-0"
            aria-label="发送"
          >
            <PaperPlaneTilt size={16} weight="fill" />
          </button>
        </div>
      </div>
    </div>
  );
};

// === 图片大图查看 ===
const ImageViewer: React.FC<{ src: string; onClose: () => void }> = ({ src, onClose }) => {
  return (
    <div
      className="absolute inset-0 z-50 bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white active:scale-95 transition-transform z-10"
        aria-label="关闭"
      >
        <X size={20} weight="bold" />
      </button>
      <img
        src={src}
        alt=""
        className="max-w-full max-h-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

export default MomentsPage;
