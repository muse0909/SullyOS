// cjjc 你画我猜移植到 SullyOS - 角色联动版（B 方案：视觉模型 + 角色 API 拆开调）
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { safeFetchJson, extractContent } from '../utils/safeApi';

type Phase = 'setup' | 'drawing' | 'guessing' | 'end';

interface ChatMsg {
    sender: string;
    text: string;
    type: 'text' | 'image';
}

interface Stroke {
    points: [number, number][];
    color: string;
}

const DG_WORDS = [
    '猫', '狗', '苹果', '雨伞', '房子', '树', '汽车', '鱼', '鸟', '花',
    '月亮', '太阳', '山', '海', '星星', '爱心', '皇冠', '钥匙', '手机', '电脑',
    '蛋糕', '冰淇淋', '咖啡', '茶', '猫头鹰', '蝴蝶', '蜗牛', '兔子', '龙', '蛇',
    '飞机', '船', '火车', '自行车', '高跟鞋', '眼镜', '帽子', '雨衣', '吉他', '钢琴',
];

const COLORS = ['#000', '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];

const DrawGuessApp: React.FC = () => {
    const { closeApp, characters, apiConfig, addToast, userProfile } = useOS();
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [phase, setPhase] = useState<Phase>('setup');
    const [currentRoleId, setCurrentRoleId] = useState<string>('');
    const [host, setHost] = useState<'user' | 'ai'>('user');
    const [currentWord, setCurrentWord] = useState<string>('');
    const [chatLog, setChatLog] = useState<ChatMsg[]>([]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [drawColor, setDrawColor] = useState('#000');
    const [isEraser, setIsEraser] = useState(false);
    const [strokes, setStrokes] = useState<Stroke[]>([]);

    const currentRole = characters.find(c => c.id === currentRoleId);

    // 画板尺寸跟随容器（用 useLayoutEffect 同步在 layout 后跑，offsetWidth 更可靠）
    // 注意：只依赖 phase，不依赖 strokes —— strokes 变化时不应重设 canvas.width（会清空画布）
    useLayoutEffect(() => {
        if (phase === 'setup') return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const size = canvas.offsetWidth;
        if (size === 0) return;
        canvas.width = size * 2;
        canvas.height = size * 2;
    }, [phase]);

    // 重绘所有笔画
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx || !canvas) return;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        strokes.forEach(stroke => {
            if (stroke.points.length < 2) return;
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.color === '#fff' ? 24 : 6;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const [sx, sy] = stroke.points[0];
            ctx.moveTo((sx / 100) * canvas.width, (sy / 100) * canvas.height);
            for (let i = 1; i < stroke.points.length; i++) {
                const [x, y] = stroke.points[i];
                ctx.lineTo((x / 100) * canvas.width, (y / 100) * canvas.height);
            }
            ctx.stroke();
        });
    }, [strokes]);

    // 坐标归一化到 0-100
    const getCoords = (e: React.MouseEvent | React.TouchEvent): [number, number] => {
        const canvas = canvasRef.current;
        if (!canvas) return [0, 0];
        const rect = canvas.getBoundingClientRect();
        const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
        return [
            Math.max(0, Math.min(100, ((cx - rect.left) / rect.width) * 100)),
            Math.max(0, Math.min(100, ((cy - rect.top) / rect.height) * 100)),
        ];
    };

    const [drawing, setDrawing] = useState(false);
    const curRef = useRef<[number, number][]>([]);

    const onStart = (e: React.MouseEvent | React.TouchEvent) => {
        if (host === 'ai') return;
        e.preventDefault();
        setDrawing(true);
        curRef.current = [getCoords(e)];
    };

    const onMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!drawing) return;
        e.preventDefault();
        const pt = getCoords(e);
        const last = curRef.current[curRef.current.length - 1];
        if (Math.abs(pt[0] - last[0]) < 1 && Math.abs(pt[1] - last[1]) < 1) return;
        curRef.current.push(pt);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx || !canvas) return;
        ctx.strokeStyle = isEraser ? '#fff' : drawColor;
        ctx.lineWidth = isEraser ? 24 : 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const [lx, ly] = last;
        ctx.moveTo((lx / 100) * canvas.width, (ly / 100) * canvas.height);
        const [nx, ny] = pt;
        ctx.lineTo((nx / 100) * canvas.width, (ny / 100) * canvas.height);
        ctx.stroke();
    };

    const onEnd = () => {
        if (!drawing) return;
        setDrawing(false);
        if (curRef.current.length >= 2) {
            setStrokes(prev => [...prev, { points: curRef.current, color: isEraser ? '#fff' : drawColor }]);
        }
        curRef.current = [];
    };

    const clearCanvas = () => setStrokes([]);

    const appendChat = (sender: string, text: string) => {
        setChatLog(prev => [...prev, { sender, text, type: 'text' }]);
    };

    const sysLog = (text: string) => appendChat('系统', text);

    // 视觉模型识别（B 方案：独立视觉 API，不带角色人设，纯识别）
    const identifyImage = async (imageBase64: string): Promise<string> => {
        if (!apiConfig?.visionBaseUrl || !apiConfig?.visionApiKey || !apiConfig?.visionModel) {
            throw new Error('视觉 API 未配置（设置 → 视觉模型 填 baseUrl / apiKey / model）');
        }
        const data = await safeFetchJson(
            `${apiConfig.visionBaseUrl}/chat/completions`,
            {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiConfig.visionApiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: apiConfig.visionModel,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: '用中文简洁描述这张图里画的是什么（10-20 字）。只输出描述，不要多余的话。' },
                            { type: 'image_url', image_url: { url: imageBase64 } },
                        ],
                    }],
                    temperature: 0.3,
                }),
            },
            2, 0, 'openai'
        );
        return extractContent(data);
    };

    // 角色 API 包装（语言模型 + systemPrompt 注入人设）
    const callCharacter = async (imageDescription: string, extraPrompt = ''): Promise<string[]> => {
        if (!currentRole || !apiConfig?.baseUrl) throw new Error('未配置');
        const persona = [currentRole.systemPrompt || '', currentRole.worldview || ''].filter(Boolean).join('\n');
        const chatContext = chatLog.slice(-15).map(m => `${m.sender}: ${m.text}`).join('\n');
        const prompt = `【游戏】你画我猜
【你的身份】${currentRole.name}（人设: ${persona || '通用'}）
${imageDescription ? `【视觉识别】用户画的图被识别为："${imageDescription}"` : ''}
【聊天历史】${chatContext || '(刚开始)'}
${extraPrompt}

【规则】
1. 用人设语气回应。
2. 1-8 条短话 JSON 数组。
3. 严禁 emoji。
${imageDescription ? '4. 不要直接说视觉识别的原话，用人设方式表达。' : ''}`;
        const data = await safeFetchJson(
            `${apiConfig.baseUrl}/chat/completions`,
            {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiConfig.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.9,
                }),
            },
            2, 0, 'openai'
        );
        const content = extractContent(data);
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch {
                return [content];
            }
        }
        return [content];
    };

    // AI 画画（角色语言模型生成坐标）
    const aiDraw = useCallback(async () => {
        if (!currentRole || !apiConfig?.baseUrl) {
            addToast('请先配置 API', 'error');
            return;
        }
        setIsLoading(true);
        setStrokes([]);
        const word = DG_WORDS[Math.floor(Math.random() * DG_WORDS.length)];
        setCurrentWord(word);
        sysLog(`${currentRole.name} 正在构思怎么画...`);
        const persona = [currentRole.systemPrompt || '', currentRole.worldview || ''].filter(Boolean).join('\n') || '通用';
        const prompt = `【你的身份】你是"${currentRole.name}"，人设"${persona}"。
你正在玩"你画我猜"，需要在正方形画板上画【${word}】。
输出"线条坐标数组"。

【规则】
1. 坐标系：左上 [0,0]，右下 [100,100]。
2. 画风贴人设：严谨/高冷/聪明 → 精准几何；呆萌/活泼/笨拙/疯批 → 抽象歪扭。
3. JSON 三维数组：[ [ [x,y], [x,y] ], ... ]

【绝对禁令】严禁多余文本 / markdown。只返回 JSON。`;
        try {
            const data = await safeFetchJson(
                `${apiConfig.baseUrl}/chat/completions`,
                {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiConfig.apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.5,
                    }),
                },
                2, 0, 'openai'
            );
            const content = extractContent(data);
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            let strokesData: number[][][] = [];
            if (jsonMatch) {
                strokesData = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON');
            }
            for (const strokePoints of strokesData) {
                if (strokePoints.length < 2) continue;
                setStrokes(prev => [...prev, { points: strokePoints.map(p => [p[0], p[1]] as [number, number]), color: '#000' }]);
                await new Promise(r => setTimeout(r, 500));
            }
            sysLog(`${currentRole.name} 画完了，轮到 ${userProfile.name} 猜`);
            setPhase('guessing');
        } catch (e) {
            console.error('AI 画画失败', e);
            addToast('AI 画画失败，画个兜底叉', 'error');
            setStrokes([{ points: [[10, 10], [90, 90]], color: '#000' }, { points: [[90, 10], [10, 90]], color: '#000' }]);
            setPhase('guessing');
        } finally {
            setIsLoading(false);
        }
    }, [currentRole, apiConfig, addToast, userProfile.name]);

    // 用户画完 → 视觉 + 角色
    const finishDrawing = async () => {
        if (!canvasRef.current) return;
        setIsLoading(true);
        const dataUrl = canvasRef.current.toDataURL('image/png');
        sysLog(`${userProfile.name} 画完了，等待 ${currentRole?.name || '角色'} 猜`);
        try {
            const description = await identifyImage(dataUrl);
            const replies = await callCharacter(description, `请用你人设的语气回应"${description}"这个识别结果，假装你在猜图。`);
            for (const reply of replies) {
                appendChat(currentRole?.name || '角色', reply);
                await new Promise(r => setTimeout(r, 600));
            }
        } catch (e) {
            console.error('猜图失败', e);
            addToast('猜图失败', 'error');
        } finally {
            setIsLoading(false);
            setPhase('end');
        }
    };

    // 用户发消息
    const sendMessage = async () => {
        if (!userInput.trim() || !currentRole) return;
        const text = userInput.trim();
        setUserInput('');
        appendChat(userProfile.name, text);
        setIsLoading(true);
        try {
            const replies = await callCharacter('', `用户说："${text}"，请用 1-8 条短话回应。`);
            for (const reply of replies) {
                appendChat(currentRole.name, reply);
                await new Promise(r => setTimeout(r, 500));
            }
        } catch (e) {
            console.error('发送失败', e);
        } finally {
            setIsLoading(false);
        }
    };

    // 阶段切换
    const startGame = () => {
        if (!currentRole) {
            addToast('请先选择角色', 'error');
            return;
        }
        setChatLog([]);
        setStrokes([]);
        setCurrentWord('');
        sysLog(`开始游戏，${currentRole.name} 上场`);
        if (host === 'ai') {
            setPhase('drawing');
            aiDraw();
        } else {
            setPhase('drawing');
        }
    };

    const startNewRound = () => {
        setChatLog([]);
        setStrokes([]);
        setCurrentWord('');
        if (host === 'ai') {
            setPhase('drawing');
            aiDraw();
        } else {
            setPhase('drawing');
        }
    };

    const quitGame = () => {
        setPhase('setup');
        setChatLog([]);
        setStrokes([]);
        setCurrentWord('');
    };

    return (
        <div className="flex flex-col h-full bg-white">
            {/* 顶部 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={closeApp} className="text-2xl text-gray-600">×</button>
                <div className="font-bold text-base">
                    {phase === 'setup' ? '你画我猜' :
                        phase === 'drawing' ? (host === 'ai' ? `${currentRole?.name || '角色'} 画图中…` : '你画') :
                            phase === 'guessing' ? '猜词中' : '本局结束'}
                </div>
                {phase !== 'setup' ? (
                    <button onClick={quitGame} className="text-sm text-gray-500">退出</button>
                ) : <div className="w-8" />}
            </div>

            {/* 设置阶段 */}
            {phase === 'setup' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div>
                        <div className="font-bold mb-2 text-sm">谁当画手</div>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setHost('ai')}
                                className={`p-3 rounded-lg border-2 text-sm ${host === 'ai' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                            >
                                🤖 {currentRole?.name || '角色'} 画
                            </button>
                            <button
                                onClick={() => setHost('user')}
                                className={`p-3 rounded-lg border-2 text-sm ${host === 'user' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                            >
                                ✏️ 我画
                            </button>
                        </div>
                    </div>

                    <div>
                        <div className="font-bold mb-2 text-sm">选角色</div>
                        {characters.length === 0 ? (
                            <div className="text-sm text-gray-400 p-3 border rounded-lg text-center">
                                还没有角色，先去创建
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                {characters.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => setCurrentRoleId(c.id)}
                                        className={`w-full p-2 rounded-lg border-2 text-left ${currentRoleId === c.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                                    >
                                        <div className="font-bold text-sm">{c.name}</div>
                                        <div className="text-xs text-gray-500 line-clamp-2">{c.description || c.systemPrompt || '（无描述）'}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={startGame}
                        disabled={!currentRole}
                        className="w-full py-3 bg-green-500 text-white rounded-lg font-bold disabled:opacity-50"
                    >
                        开始游戏
                    </button>
                </div>
            )}

            {/* 游戏阶段 */}
            {phase !== 'setup' && (
                <>
                    {/* 画板 */}
                    <div className="p-2">
                        <div className="w-full border-2 border-gray-200 rounded-lg overflow-hidden bg-white" style={{ aspectRatio: '1' }}>
                            <canvas
                                ref={canvasRef}
                                className="w-full h-full touch-none"
                                onMouseDown={onStart}
                                onMouseMove={onMove}
                                onMouseUp={onEnd}
                                onMouseLeave={onEnd}
                                onTouchStart={onStart}
                                onTouchMove={onMove}
                                onTouchEnd={onEnd}
                            />
                        </div>

                        {host === 'user' && phase === 'drawing' && (
                            <div className="flex gap-2 mt-2 flex-wrap items-center">
                                {COLORS.map(c => (
                                    <button
                                        key={c}
                                        onClick={() => { setDrawColor(c); setIsEraser(false); }}
                                        className={`w-8 h-8 rounded-full border-2 ${drawColor === c && !isEraser ? 'border-blue-500 scale-110' : 'border-gray-200'}`}
                                        style={{ background: c }}
                                    />
                                ))}
                                <button
                                    onClick={() => setIsEraser(!isEraser)}
                                    className={`px-3 py-1 rounded text-xs ${isEraser ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}
                                >
                                    橡皮
                                </button>
                                <button
                                    onClick={clearCanvas}
                                    className="px-3 py-1 rounded bg-gray-100 text-xs"
                                >
                                    清空
                                </button>
                                <button
                                    onClick={finishDrawing}
                                    disabled={isLoading || strokes.length === 0}
                                    className="ml-auto px-4 py-1.5 rounded bg-green-500 text-white text-sm font-bold disabled:opacity-50"
                                >
                                    {isLoading ? '识别中…' : '画完了'}
                                </button>
                            </div>
                        )}

                        {currentWord && phase === 'end' && host === 'ai' && (
                            <div className="text-center mt-2 text-sm text-gray-600">
                                答案：<span className="font-bold text-lg text-gray-800">{currentWord}</span>
                            </div>
                        )}
                    </div>

                    {/* 聊天 */}
                    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 bg-gray-50 min-h-0">
                        {chatLog.length === 0 && (
                            <div className="text-center text-gray-400 text-xs py-4">聊天记录会显示在这里</div>
                        )}
                        {chatLog.map((m, i) => {
                            if (m.sender === '系统') {
                                return <div key={i} className="text-center text-xs text-gray-400 py-1">{m.text}</div>;
                            }
                            const isMe = m.sender === userProfile.name;
                            return (
                                <div key={i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${isMe ? 'bg-blue-500 text-white' : 'bg-white border border-gray-200'}`}>
                                        {!isMe && <div className="text-xs opacity-60 mb-0.5">{m.sender}</div>}
                                        <div className="whitespace-pre-wrap">{m.text}</div>
                                    </div>
                                </div>
                            );
                        })}
                        {isLoading && <div className="text-center text-gray-400 text-xs">思考中…</div>}
                    </div>

                    {/* 输入框 */}
                    {phase !== 'drawing' && (
                        <div className="p-2 border-t border-gray-200 flex gap-2">
                            <input
                                value={userInput}
                                onChange={e => setUserInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && sendMessage()}
                                placeholder="说点什么…"
                                className="flex-1 px-3 py-2 rounded-full border border-gray-300 text-sm focus:outline-none focus:border-blue-500"
                            />
                            <button
                                onClick={sendMessage}
                                disabled={isLoading || !userInput.trim()}
                                className="px-4 py-2 bg-blue-500 text-white rounded-full text-sm disabled:opacity-50"
                            >
                                发送
                            </button>
                        </div>
                    )}

                    {/* 下一局 */}
                    {phase === 'end' && (
                        <div className="p-2 border-t border-gray-200">
                            <button
                                onClick={startNewRound}
                                className="w-full py-2 bg-green-500 text-white rounded-lg font-bold"
                            >
                                下一局
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default DrawGuessApp;
