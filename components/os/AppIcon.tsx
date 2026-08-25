
import React from 'react';
import { AppConfig } from '../../types';
import { Icons } from '../../constants';
import { isPaperWallpaper, useOS } from '../../context/OSContext';

interface AppIconProps {
  app: AppConfig;
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
  hideLabel?: boolean;
  variant?: 'default' | 'minimal' | 'dock';
}

const AppIcon: React.FC<AppIconProps> = React.memo(({ app, onClick, size = 'md', hideLabel = false, variant = 'default' }) => {
  const { customIcons, theme } = useOS();
  const IconComponent = Icons[app.icon] || Icons.Settings;
  const customIconUrl = customIcons[app.id];
  const contentColor = theme.contentColor || '#ffffff';
  // 暮色 8-25 同步原作者 commit f4d43a6c：纸纹模式下图标更小、无阴影、容器米色玻璃
  //   (不是 strokeWidth 改,是"秀气 = 图标小 + 阴影少 + 标签细")
  const isPaperDesktop = isPaperWallpaper(theme.wallpaper);

  // Standard sizes
  const sizeClasses =
    size === 'lg' ? 'w-[4.25rem] h-[4.25rem]' :
    size === 'sm' ? 'w-[2.75rem] h-[2.75rem]' :
    'w-[3.5rem] h-[3.5rem]';

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 group relative active:scale-95 transition-transform duration-200"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {/* Container: 暮色 8-25 纸纹模式用米色玻璃 + 淡棕阴影,默认模式保留白色毛玻璃 */}
      <div
        className={`${sizeClasses} relative flex items-center justify-center ${
          isPaperDesktop
            ? 'rounded-[1.1rem] border transition-[transform,background-color,box-shadow] duration-200 group-hover:-translate-y-0.5'
            : 'bg-white/40 rounded-[1.125rem] border border-white/35 shadow-[0_4px_12px_rgba(0,0,0,0.16)] group-hover:bg-white/50 group-hover:border-white/50'
        }`}
        style={isPaperDesktop ? {
          background: 'rgba(224,221,215,0.42)',
          borderColor: 'rgba(91,72,51,0.075)',
          boxShadow: '0 4px 12px rgba(91,72,51,0.055)',
        } : undefined}
      >

        {customIconUrl ? (
            <img src={customIconUrl} className="w-full h-full object-cover rounded-[1.2rem]" alt={app.name} loading="lazy" />
        ) : (
            <div
                className={isPaperDesktop
                  ? 'w-[47%] h-[47%] opacity-80'
                  : 'w-[50%] h-[50%] drop-shadow-[0_2px_5px_rgba(0,0,0,0.3)] opacity-90'}
                style={{ color: contentColor }}
            >
                 {/* 暮色 8-25:paper 模式 light(0.75) 太细,改回 regular(1.0),跟默认一样 — 之前的"秀气 vs 粗"差异在 AppIcon 上不保留 */}
                 <IconComponent className="w-full h-full" weight={isPaperDesktop ? 'regular' : 'regular'} />
            </div>
        )}
      </div>

      {!hideLabel && (
       <span
    className={`${size === 'sm' ? 'text-[8.5px]' : 'text-[10px]'} ${
        isPaperDesktop
          ? 'tracking-[0.08em] font-semibold opacity-75'
          : 'tracking-widest font-bold uppercase opacity-90 text-shadow-md'
    } transition-opacity max-w-full truncate ${variant === 'dock' ? 'hidden' : 'block'}`}
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
