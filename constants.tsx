import React from 'react';
import { AppConfig, AppID } from './types';
import {
  UserCircle,
  IdentificationCard,
  ChatTeardrop,
  UsersThree,
  GearSix,
  Images,
  PaintBrush,
  Palette,
  Heart,
  BookOpenText,
  SealCheck,
  House,
  DeviceMobileCamera,
  Fire,
  Books,
  Question,
  GameController,
  Globe,
  PenNib,
  PiggyBank,
  Compass,
  Camera,
  Sparkle,
  GlobeSimple,
  MusicNotes,
  PhoneCall,
  Crosshair,
  Smiley,
  Brain,
  Notebook,
  Plugs,
  Planet,
  PaintBucket,
} from '@phosphor-icons/react';
import type { IconWeight } from '@phosphor-icons/react';

// SVG 图标库 - Phosphor Icons
// 8-25: 接收外部传入的 weight prop,默认 bold,让 AppIcon 等地方能切 light/regular
export const Icons: Record<string, React.FC<{ className?: string; weight?: IconWeight }>> = {
  Character: ({ className, weight = 'bold' }) => <UserCircle className={className} weight={weight} />,
  User: ({ className, weight = 'bold' }) => <IdentificationCard className={className} weight={weight} />,
  Chat: ({ className, weight = 'bold' }) => <ChatTeardrop className={className} weight={weight} />,
  GroupChat: ({ className, weight = 'bold' }) => <UsersThree className={className} weight={weight} />,
  Settings: ({ className, weight = 'bold' }) => <GearSix className={className} weight={weight} />,
  Gallery: ({ className, weight = 'bold' }) => <Images className={className} weight={weight} />,
  ThemeMaker: ({ className, weight = 'bold' }) => <PaintBrush className={className} weight={weight} />,
  Appearance: ({ className, weight = 'bold' }) => <Palette className={className} weight={weight} />,
  Date: ({ className, weight = 'bold' }) => <Heart className={className} weight={weight} />,
  Journal: ({ className, weight = 'bold' }) => <BookOpenText className={className} weight={weight} />,
  Schedule: ({ className, weight = 'bold' }) => <SealCheck className={className} weight={weight} />,
  Room: ({ className, weight = 'bold' }) => <House className={className} weight={weight} />,
  CheckPhone: ({ className, weight = 'bold' }) => <DeviceMobileCamera className={className} weight={weight} />,
  Social: ({ className, weight = 'bold' }) => <Fire className={className} weight={weight} />,
  Study: ({ className, weight = 'bold' }) => <Books className={className} weight={weight} />,
  FAQ: ({ className, weight = 'bold' }) => <Question className={className} weight={weight} />,
  Game: ({ className, weight = 'bold' }) => <GameController className={className} weight={weight} />,
  Worldbook: ({ className, weight = 'bold' }) => <Globe className={className} weight={weight} />,
  Novel: ({ className, weight = 'bold' }) => <PenNib className={className} weight={weight} />,
  Bank: ({ className, weight = 'bold' }) => <PiggyBank className={className} weight={weight} />,
  XhsFreeRoam: ({ className, weight = 'bold' }) => <Compass className={className} weight={weight} />,
  XhsStock: ({ className, weight = 'bold' }) => <Camera className={className} weight={weight} />,
  SpecialMoments: ({ className, weight = 'bold' }) => <Sparkle className={className} weight={weight} />,
  Browser: ({ className, weight = 'bold' }) => <GlobeSimple className={className} weight={weight} />,
  Songwriting: ({ className, weight = 'bold' }) => <MusicNotes className={className} weight={weight} />,
  Music: ({ className, weight = 'fill' }) => <MusicNotes className={className} weight={weight} />,
  Call: ({ className, weight = 'bold' }) => <PhoneCall className={className} weight={weight} />,
  Guidebook: ({ className, weight = 'bold' }) => <Crosshair className={className} weight={weight} />,
  LifeSim: ({ className, weight = 'bold' }) => <Smiley className={className} weight={weight} />,
  MemoryPalace: ({ className, weight = 'bold' }) => <Brain className={className} weight={weight} />,
  Handbook: ({ className, weight = 'bold' }) => <Notebook className={className} weight={weight} />,
  QQBridge: ({ className, weight = 'bold' }) => <Plugs className={className} weight={weight} />,
  VRWorld: ({ className, weight = 'bold' }) => <Planet className={className} weight={weight} />,
  DrawGuess: ({ className, weight = 'bold' }) => <PaintBucket className={className} weight={weight} />,
};

export const INSTALLED_APPS: AppConfig[] = [
  { id: AppID.Character, name: '神经链接', icon: 'Character', color: 'indigo' },
  { id: AppID.MemoryPalace, name: '记忆宫殿', icon: 'MemoryPalace', color: 'violet' },
  { id: AppID.Chat, name: 'Message', icon: 'Chat', color: 'green' },
  { id: AppID.Call, name: '电话', icon: 'Call', color: 'emerald' },
  { id: AppID.GroupChat, name: '群聊', icon: 'GroupChat', color: 'violet' },
  { id: AppID.Worldbook, name: '世界书', icon: 'Worldbook', color: 'indigo' },         // 原电话位置
  { id: AppID.Journal, name: '交换日记', icon: 'Journal', color: 'amber' },            // 原小小窝位置
  { id: AppID.CheckPhone, name: '查手机', icon: 'CheckPhone', color: 'slate' },
  { id: AppID.Date, name: '见面', icon: 'Date', color: 'pink' },
  { id: AppID.VRWorld, name: '彼方', icon: 'VRWorld', color: 'purple' },               // 原气泡工坊位置
  { id: AppID.Appearance, name: '外观', icon: 'Appearance', color: 'slate' },           // 原存钱罐位置
  { id: AppID.Room, name: '小小窝', icon: 'Room', color: 'rose' },                     // 原交换日记位置
  { id: AppID.Gallery, name: '相册', icon: 'Gallery', color: 'orange' },               // 原自习室位置
  { id: AppID.Game, name: 'TRPG', icon: 'Game', color: 'orange' },
  { id: AppID.Schedule, name: '时光契约', icon: 'Schedule', color: 'cyan' },            // 原笔友会位置
  { id: AppID.Songwriting, name: '写歌', icon: 'Songwriting', color: 'fuchsia' },
  { id: AppID.Music, name: '音乐', icon: 'Music', color: 'rose' },
  { id: AppID.XhsStock, name: '小红书图库', icon: 'XhsStock', color: 'red' },          // 原时光契约位置
  { id: AppID.XhsFreeRoam, name: '自由活动', icon: 'XhsFreeRoam', color: 'rose' },     // 原世界书位置
  { id: AppID.FAQ, name: '使用帮助', icon: 'FAQ', color: 'indigo' },
  { id: AppID.Social, name: 'Spark', icon: 'Social', color: 'red' },
  { id: AppID.Novel, name: '笔友会', icon: 'Novel', color: 'amber' },                  // 原小红书图库位置
  { id: AppID.Bank, name: '存钱罐', icon: 'Bank', color: 'lime' },                     // 原外观位置
  { id: AppID.Guidebook, name: '攻略本', icon: 'Guidebook', color: 'slate' },
  { id: AppID.LifeSim, name: '都市人生', icon: 'LifeSim', color: 'purple' },
  { id: AppID.SpecialMoments, name: '特别时光', icon: 'SpecialMoments', color: 'pink' },
  // 暮色 2026-07-31：情侣空间不放 Launcher（暮色"Launcher 主页的就不要了"），只从发现页进
  //   AppID.CoupleSpace 保留以支持 DiscoverPage 入口的 openApp(AppID.CoupleSpace)
  { id: AppID.Settings, name: '设置', icon: 'Settings', color: 'slate' },
  { id: AppID.DrawGuess, name: '你画我猜', icon: 'DrawGuess', color: 'sky' },
];

export const DOCK_APPS = [AppID.Call, AppID.Chat, AppID.GroupChat, AppID.Settings];

