// MomentsPage — 朋友圈主页
// 仿微信：顶部工具栏（sticky）+ 封面图 + 名字/签名/头像（一起滚）+ 动态列表
// 头像形状跟随主题 OSTheme.chatAvatarShape（circle / rounded / square）
// 签名可编辑（点签名 → FullScreenEditor v2）
// 封面图长按换图（FileReader → localStorage）
// 相机按钮：跳到发布器（先占位：弹个简单输入框）

import React, { useEffect, useRef, useState } from 'react';
import { CaretLeft, Gear, Camera, Heart, ChatCircleDots } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import {
  MomentPost,
  getAllPosts,
  addPost,
  getSignature,
  setSignature,
  getCoverImage,
  setCoverImage,
  genPostId,
} from '../utils/momentsStorage';
import FullScreenEditor from '../components/common/FullScreenEditor';

const MomentsPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { theme, userProfile, addToast } = useOS();
  const [posts, setPosts] = useState<MomentPost[]>([]);
  const [signature, setSigState] = useState(getSignature());
  const [coverImage, setCoverImageState] = useState<string | null>(getCoverImage());
  const [editingSignature, setEditingSignature] = useState(false);
  const [showPublisher, setShowPublisher] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setPosts(getAllPosts());
  }, []);

  // 头像形状
  const avatarShape = theme.chatAvatarShape || 'circle';
  const avatarClass =
    avatarShape === 'circle' ? 'rounded-full' :
    avatarShape === 'rounded' ? 'rounded-2xl' :
    'rounded-md';

  // 封面图长按换图
  const handleCoverPointerDown = () => {
    longPressTimerRef.current = window.setTimeout(() => {
      if (window.confirm('换封面图？（取消则恢复默认渐变）')) {
        fileInputRef.current?.click();
      } else {
        setCoverImage(null);
        setCoverImageState(null);
        addToast('已恢复默认封面', 'success');
      }
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

  // 签名保存
  const handleSignatureConfirm = (text: string) => {
    setSignature(text);
    setSigState(text);
    setEditingSignature(false);
    addToast('签名已更新', 'success');
  };

  // 发布朋友圈（最简版：文本 + 可选图片，先用一个简单的输入）
  const handlePublish = (text: string, images: string[]) => {
    if (!text.trim() && images.length === 0) return;
    const newPost: MomentPost = {
      id: genPostId(),
      authorType: 'user',
      content: text,
      images,
      createdAt: Date.now(),
      likes: [],
      comments: [],
    };
    const next = addPost(newPost);
    setPosts(next);
    setShowPublisher(false);
    addToast('已发表', 'success');
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-[#ededed] overflow-hidden">
      {/* 顶部工具栏（sticky） */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-2 py-2 pointer-events-none">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-black/30 backdrop-blur flex items-center justify-center text-white pointer-events-auto active:scale-95 transition-transform"
          aria-label="返回"
        >
          <CaretLeft size={20} weight="bold" />
        </button>
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            className="w-9 h-9 rounded-full bg-black/30 backdrop-blur flex items-center justify-center text-white active:scale-95 transition-transform"
            aria-label="设置"
            onClick={() => addToast('朋友圈设置 — 下一轮做', 'info')}
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
        {/* 封面图 + 名字/签名/头像 = 一起滚的单元 */}
        <div
          className="relative"
          style={{ height: 280, background: coverImage ? undefined : 'linear-gradient(180deg, #5d4037 0%, #8d6e63 30%, #d7a96e 60%, #f4e4bc 100%)' }}
          onPointerDown={handleCoverPointerDown}
          onPointerUp={handleCoverPointerUp}
          onPointerLeave={handleCoverPointerUp}
        >
          {coverImage && (
            <img src={coverImage} alt="封面" className="absolute inset-0 w-full h-full object-cover" />
          )}

          {/* 名字"暮色" — 右上方 */}
          <div className="absolute z-10" style={{ top: 220, right: 80 }}>
            <span className="text-white text-sm font-semibold drop-shadow-md">{userProfile.name}</span>
          </div>

          {/* 签名 — 名字下方，宽度大 */}
          <div className="absolute z-10" style={{ top: 240, left: 16, right: 80 }}>
            <button
              onClick={() => setEditingSignature(true)}
              className="text-left w-full hover:opacity-80 transition-opacity"
            >
              <span className="text-white/95 text-[12px] drop-shadow-md leading-snug block">
                {signature || '点此添加签名...'}
              </span>
            </button>
          </div>

          {/* 圆形头像 — 右下角（跟随主题 chatAvatarShape） */}
          <div className="absolute z-10" style={{ bottom: 12, right: 12 }}>
            <div
              className={`w-16 h-16 ${avatarClass} border-2 border-white shadow-lg flex items-center justify-center text-white text-xl font-bold`}
              style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}
            >
              {(userProfile.name || '?').slice(0, 1)}
            </div>
          </div>
        </div>

        {/* 动态列表 */}
        <div className="bg-white min-h-[200px]">
          {posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Camera size={36} weight="regular" className="mb-3 opacity-50" />
              <div className="text-sm">还没有动态</div>
              <div className="text-[11px] mt-1">点右上角相机发一条吧</div>
            </div>
          ) : (
            posts.map((post) => (
              <PostCard key={post.id} post={post} avatarClass={avatarClass} />
            ))
          )}
        </div>
      </div>

      {/* 隐藏的 file input（长按封面图触发） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleCoverFileChange}
      />

      {/* 签名编辑器 */}
      {editingSignature && (
        <FullScreenEditor
          title="编辑签名"
          value={signature}
          onClose={() => setEditingSignature(false)}
          onConfirm={handleSignatureConfirm}
        />
      )}

      {/* 极简发布器（占位，下一轮做完整版） */}
      {showPublisher && (
        <SimplePublisher
          onClose={() => setShowPublisher(false)}
          onPublish={handlePublish}
        />
      )}
    </div>
  );
};

// === 极简发布器（这一轮先用，最简版） ===
const SimplePublisher: React.FC<{
  onClose: () => void;
  onPublish: (text: string, images: string[]) => void;
}> = ({ onClose, onPublish }) => {
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="absolute inset-0 z-30 bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <button onClick={onClose} className="text-sm text-slate-500">取消</button>
        <h2 className="text-sm font-semibold text-slate-800">发表朋友圈</h2>
        <button
          onClick={() => onPublish(text, image ? [image] : [])}
          disabled={!text.trim() && !image}
          className="px-4 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded-full disabled:opacity-40"
        >
          发表
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

// === 单条 post 卡片（极简） ===
const PostCard: React.FC<{ post: MomentPost; avatarClass: string }> = ({ post, avatarClass }) => {
  const { characters } = useOS();
  const authorChar = post.authorType === 'char' ? characters.find((c) => c.id === post.charId) : null;
  const authorName = post.authorType === 'user' ? '暮色' : authorChar?.name || 'AI';
  const authorAvatarBg = post.authorType === 'user'
    ? 'linear-gradient(135deg, #fbbf24, #f59e0b)'
    : (authorChar?.themeColor ? `hsl(${authorChar.themeColor}, 70%, 65%)` : 'linear-gradient(135deg, #a78bfa, #8b5cf6)');

  return (
    <div className="flex gap-3 p-3 border-b border-slate-100 bg-white">
      <div
        className={`w-10 h-10 ${avatarClass} shrink-0 flex items-center justify-center text-white font-bold text-sm`}
        style={{ background: authorAvatarBg }}
      >
        {authorName.slice(0, 1)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800">{authorName}</div>
        <div className="text-sm text-slate-700 mt-1 leading-relaxed whitespace-pre-wrap break-words">{post.content}</div>
        {post.images.length > 0 && (
          <div
            className="mt-2 grid gap-1"
            style={{ gridTemplateColumns: post.images.length === 1 ? '1fr' : 'repeat(3, 1fr)', maxWidth: post.images.length === 1 ? 220 : undefined }}
          >
            {post.images.map((img, i) => (
              <img key={i} src={img} alt="" className="w-full aspect-square object-cover rounded" />
            ))}
          </div>
        )}
        <div className="text-[10px] text-slate-400 mt-1.5">{formatTime(post.createdAt)}</div>
        {(post.likes.length > 0 || post.comments.length > 0) && (
          <div className="mt-2 bg-slate-50 rounded-lg p-2 text-xs space-y-1">
            {post.likes.length > 0 && (
              <div className="flex items-center gap-1 text-slate-700">
                <Heart size={12} weight="fill" className="text-red-400" />
                <span>{post.likes.length} 人赞过</span>
              </div>
            )}
            {post.comments.length > 0 && (
              <div className="space-y-0.5 text-slate-700">
                {post.comments.slice(0, 2).map((c) => (
                  <div key={c.id}>
                    <span className="font-semibold text-slate-800">{c.authorType === 'user' ? '暮色' : (characters.find((x) => x.id === c.charId)?.name || 'AI')}：</span>
                    <span>{c.content}</span>
                  </div>
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
