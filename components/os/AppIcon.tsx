
import React from 'react';
import { AppConfig } from '../../types';
import { Icons } from '../../constants';
import { useOS } from '../../context/OSContext';

interface AppIconProps {
  app: AppConfig;
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
  hideLabel?: boolean;
  variant?: 'default' | 'minimal' | 'dock';
}

// 动森（NookPhone）风格图标的配色：把各 App 的 Tailwind 色名映射成明快的糖果色方块底。
const NOOK_TILE_COLORS: Record<string, string> = {
  indigo: '#7E8AE6', violet: '#A584E0', purple: '#B06FD6', fuchsia: '#E07BC6',
  pink: '#F58FB4', rose: '#F58198', red: '#F47A6E', orange: '#F5A65B',
  amber: '#F5C24B', lime: '#A8D45C', green: '#6FCB7E', emerald: '#5BC8A0',
  cyan: '#5BC2D4', blue: '#6FA8E6', slate: '#94A3B8',
};

const AppIcon: React.FC<AppIconProps> = React.memo(({ app, onClick, size = 'md', hideLabel = false, variant = 'default' }) => {
  const { customIcons, theme } = useOS();
  const IconComponent = Icons[app.icon] || Icons.Settings;
  const customIconUrl = customIcons[app.id];
  const isNook = theme.skin === 'animalcrossing';
  // 动森皮肤下标签用深棕色，普通皮肤沿用主题 contentColor。
  const contentColor = isNook ? '#5b4a2f' : (theme.contentColor || '#ffffff');

  // Standard sizes
  const sizeClasses =
    size === 'lg' ? 'w-[4.25rem] h-[4.25rem]' :
    size === 'sm' ? 'w-[2.75rem] h-[2.75rem]' :
    'w-[3.5rem] h-[3.5rem]';

  if (isNook && !customIconUrl) {
    const tileColor = NOOK_TILE_COLORS[app.color] || NOOK_TILE_COLORS.slate;
    return (
      <button
        onClick={onClick}
        className="flex flex-col items-center gap-1.5 group relative active:scale-95 transition-transform duration-200"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        {/* NookPhone 风格：饱和糖果色圆角方块 + 白色符号 + 顶部高光 */}
        <div
          className={`${sizeClasses} relative flex items-center justify-center rounded-[1.4rem]
            border border-white/70 shadow-[0_5px_14px_rgba(80,60,30,0.22)] overflow-hidden`}
          style={{ backgroundColor: tileColor }}
        >
          {/* 顶部柔光，营造塑料圆钮质感 */}
          <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/40 to-transparent pointer-events-none" />
          <div className="w-[52%] h-[52%] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)] relative">
            <IconComponent className="w-full h-full" />
          </div>
        </div>
        {!hideLabel && (
          <span
            className={`${size === 'sm' ? 'text-[8.5px] tracking-wide' : 'text-[10px] tracking-wider'} font-bold text-shadow-sm max-w-full truncate ${variant === 'dock' ? 'hidden' : 'block'}`}
            style={{ color: contentColor }}
          >
            {app.name}
          </span>
        )}
      </button>
    );
  }

  return (
    <button 
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 group relative active:scale-95 transition-transform duration-200"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {/* Container: translucent tile (blur removed for perf — blur × 8+ icons stalls launcher) */}
      <div className={`${sizeClasses} relative flex items-center justify-center
        bg-white/40 rounded-[1.125rem]
        border border-white/35
        shadow-[0_4px_12px_rgba(0,0,0,0.16)]
        group-hover:bg-white/50 group-hover:border-white/50
      `}>

        {customIconUrl ? (
            <img src={customIconUrl} className="w-full h-full object-cover rounded-[1.2rem]" alt={app.name} loading="lazy" />
        ) : (
            <div 
                className="w-[50%] h-[50%] drop-shadow-[0_2px_5px_rgba(0,0,0,0.3)] opacity-90"
                style={{ color: contentColor }}
            >
                 <IconComponent className="w-full h-full" />
            </div>
        )}
      </div>
      
      {!hideLabel && (
        <span
            className={`${size === 'sm' ? 'text-[8.5px] tracking-wider' : 'text-[10px] tracking-widest'} font-bold uppercase opacity-80 text-shadow-md transition-opacity max-w-full truncate ${variant === 'dock' ? 'hidden' : 'block'}`}
            style={{ color: contentColor }}
        >
          {app.name}
        </span>
      )}
    </button>
  );
}, (prev, next) => {
    // Custom comparison to prevent re-render unless specific props change
    // We don't check 'onClick' deeply assuming it's stable or we want to ignore function ref changes
    return prev.app.id === next.app.id && 
           prev.size === next.size && 
           prev.hideLabel === next.hideLabel &&
           prev.variant === next.variant;
});

export default AppIcon;
