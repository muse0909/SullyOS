// NoteSearchBar — 私密记事搜索栏（暮色 2026-07-17：关键词 + 日期筛选）
// 设计：居中胶囊行，暮色马卡龙审美

import React from 'react';
import { MagnifyingGlass, X, Calendar } from '@phosphor-icons/react';

interface NoteSearchBarProps {
    keyword: string;
    onKeywordChange: (v: string) => void;
    dateFrom: string;        // YYYY-MM-DD or ''
    dateTo: string;          // YYYY-MM-DD or ''
    onDateFromChange: (v: string) => void;
    onDateToChange: (v: string) => void;
}

const NoteSearchBar: React.FC<NoteSearchBarProps> = ({
    keyword, onKeywordChange,
    dateFrom, dateTo, onDateFromChange, onDateToChange,
}) => {
    const hasFilter = !!keyword || !!dateFrom || !!dateTo;
    const clearAll = () => {
        onKeywordChange('');
        onDateFromChange('');
        onDateToChange('');
    };

    return (
        <div className="space-y-2">
            {/* 关键词搜索 */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-white/85 backdrop-blur rounded-full shadow-sm border border-white/60">
                <MagnifyingGlass size={16} weight="regular" className="text-slate-400 shrink-0" />
                <input
                    type="text"
                    value={keyword}
                    onChange={(e) => onKeywordChange(e.target.value)}
                    placeholder="搜内容..."
                    className="flex-1 bg-transparent outline-none text-xs text-slate-700 placeholder:text-slate-300"
                />
                {keyword && (
                    <button onClick={() => onKeywordChange('')} className="text-slate-300 hover:text-slate-500">
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* 日期范围 */}
            <div className="flex items-center gap-2 px-3 py-2 bg-white/70 backdrop-blur rounded-2xl border border-white/60">
                <Calendar size={14} weight="regular" className="text-slate-400 ml-1 shrink-0" />
                <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => onDateFromChange(e.target.value)}
                    className="flex-1 min-w-0 bg-transparent outline-none text-[11px] text-slate-600"
                />
                <span className="text-slate-300 text-[10px]">至</span>
                <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => onDateToChange(e.target.value)}
                    className="flex-1 min-w-0 bg-transparent outline-none text-[11px] text-slate-600"
                />
                {hasFilter && (
                    <button
                        onClick={clearAll}
                        className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-rose-50 text-rose-500 hover:bg-rose-100 transition-colors"
                    >
                        清空
                    </button>
                )}
            </div>
        </div>
    );
};

export default NoteSearchBar;
