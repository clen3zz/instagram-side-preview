// ==UserScript==
// @name         Instagram Side Preview (IG双侧预览)
// @namespace    https://github.com/clen3zz/
// @version      5.1
// @description  IG侧边预览：自动显示上一张/下一张，无需点击箭头。独家修复视频封面黑屏问题（Canvas截图），防闪烁，无缝浏览。
// @author       clen3zz
// @match        https://www.instagram.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/clen3zz/instagram-side-preview/main/instagram-side-preview.user.js
// @downloadURL  https://raw.githubusercontent.com/clen3zz/instagram-side-preview/main/instagram-side-preview.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ================= 配置区域 =================
    const CONFIG = {
        sideWidth: 220,
        topOffset: 180,
        hideDelay: 300,
    };

    // ================= 样式注入 =================
    const css = `
        .ig-side-container {
            position: absolute;
            top: ${CONFIG.topOffset}px;
            width: ${CONFIG.sideWidth}px;
            display: none;
            flex-direction: column;
            z-index: 9;
            pointer-events: auto;
            transition: opacity 0.2s ease;
            opacity: 1;
        }
        .ig-side-left { right: 100%; margin-right: 15px; align-items: flex-end; }
        .ig-side-right { left: 100%; margin-left: 15px; align-items: flex-start; }

        .ig-side-item {
            position: relative;
            width: 100%;
            border-radius: 6px;
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(0,0,0,0.15);
            background: #262626;
            flex-shrink: 0;
            cursor: pointer;
            min-height: 100px;
        }
        .ig-side-item img {
            display: block;
            width: 100%;
            height: auto;
            max-height: 400px;
            object-fit: cover;
        }
        .ig-side-video-badge {
            position: absolute;
            top: 10px; right: 10px;
            width: 12px; height: 12px;
            background: #ff3b30;
            border: 2px solid white;
            border-radius: 50%;
            z-index: 5;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .ig-placeholder {
            width: 100%; height: 200px;
            display: flex; align-items: center; justify-content: center;
            color: #666; font-size: 12px; font-weight: bold;
        }
        article { overflow: visible !important; }
    `;
    GM_addStyle(css);

    // ================= 核心工具 =================

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    /**
     * 核心函数：从一个容器 DOM 中挖出最佳图片
     * 无论是视频还是图片，都优先找 img 标签（哪怕是隐藏的）
     */
    function extractBestSource(container) {
        if (!container) return null;

        // 1. 优先搜索所有 img
        const imgs = Array.from(container.querySelectorAll('img'));
        // 过滤掉头像和超小图
        const validImgs = imgs.filter(img => {
            const w = img.naturalWidth || img.clientWidth || 0;
            const alt = (img.alt || "").toLowerCase();
            if (alt.includes("profile") || alt.includes("avatar")) return false;
            // 只要原图够大，哪怕现在 display:none 也是我们要的目标
            return w > 150 || (img.src && img.src.length > 50);
        });

        // 按尺寸排序，取最大的
        if (validImgs.length > 0) {
            validImgs.sort((a, b) => {
                const wa = a.naturalWidth || 0;
                const wb = b.naturalWidth || 0;
                return wb - wa;
            });
            return { src: validImgs[0].src, isVideo: false, el: container };
        }

        // 2. 如果真的没有 img，找 video
        const vid = container.querySelector('video');
        if (vid) {
            // 2.1 优先用 poster
            if (vid.poster && vid.poster.length > 10) {
                return { src: vid.poster, isVideo: true, el: container };
            }
            // 2.2 尝试 canvas 截图 (兜底)
            try {
                if (vid.readyState >= 1) {
                    const canvas = document.createElement('canvas');
                    canvas.width = vid.videoWidth || 300;
                    canvas.height = vid.videoHeight || 400;
                    canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
                    const data = canvas.toDataURL();
                    if (data.length > 100) return { src: data, isVideo: true, el: container };
                }
            } catch(e) {}

            // 2.3 实在不行返回占位
            return { src: "PLACEHOLDER", isVideo: true, el: container };
        }

        return null;
    }

    // ================= 逻辑核心：容器锁定 =================

    function getMediaData(article) {
        // 1. 寻找 List 容器
        // 尝试寻找包含 transform 的 li 所在的 ul
        let listItems = Array.from(article.querySelectorAll('ul li'));

        // 如果找不到 ul li 结构 (某些单图贴或特殊布局)，尝试找 div 结构
        if (listItems.length < 2) {
            // 备用方案：直接找所有大图/视频，按几何位置排
            return getMediaDataGeometric(article);
        }

        // 2. 找到“当前显示”的那个 li
        // 方法：计算每个 li 的中心点，离 article 中心最近的胜出
        const articleRect = article.getBoundingClientRect();
        const centerX = articleRect.left + articleRect.width / 2;

        let currentIndex = -1;
        let minDiff = Infinity;

        listItems.forEach((li, index) => {
            const rect = li.getBoundingClientRect();
            // 必须是可视的或者带有 transform 的
            // 忽略宽度极小的（可能被折叠）
            if (rect.width < 10 && rect.height < 10) return;

            const itemX = rect.left + rect.width / 2;
            const diff = Math.abs(itemX - centerX);

            if (diff < minDiff) {
                minDiff = diff;
                currentIndex = index;
            }
        });

        if (currentIndex === -1) return null;

        // 3. 锁定邻居
        // 既然我们找到了 Current 的索引，那么 Previous 就是 index-1, Next 就是 index+1
        // 这比计算坐标要稳定得多！
        const prevLi = listItems[currentIndex - 1];
        const nextLi = listItems[currentIndex + 1];

        // 4. 提取内容
        const leftData = prevLi ? extractBestSource(prevLi) : null;
        const rightData = nextLi ? extractBestSource(nextLi) : null;

        return { left: leftData, right: rightData };
    }

    // 备用方案：几何定位 (针对单图或非列表结构)
    function getMediaDataGeometric(article) {
        const medias = Array.from(article.querySelectorAll('img, video'));
        const candidates = medias.filter(el => {
            if (el.closest('header')) return false;
            return el.clientWidth > 200;
        }).map(el => ({
            el: el,
            rect: el.getBoundingClientRect()
        }));

        if (candidates.length < 2) return null;

        const articleRect = article.getBoundingClientRect();
        const centerX = articleRect.left + articleRect.width / 2;
        const threshold = 50;

        let lefts = [], rights = [];
        candidates.forEach(item => {
            const diff = (item.rect.left + item.rect.width/2) - centerX;
            if (diff < -threshold) lefts.push(item);
            else if (diff > threshold) rights.push(item);
        });

        lefts.sort((a,b) => b.rect.left - a.rect.left); // 最靠右
        rights.sort((a,b) => a.rect.left - b.rect.left); // 最靠左

        return {
            left: lefts[0] ? extractBestSource(lefts[0].el.parentElement) : null,
            right: rights[0] ? extractBestSource(rights[0].el.parentElement) : null
        };
    }

    // ================= 渲染 =================

    function createPreview(itemData) {
        if (!itemData) return null;

        const div = document.createElement('div');
        div.className = 'ig-side-item';

        // 滚动行为
        div.onclick = (e) => {
            e.stopPropagation();
            // 尝试找到 IG 的翻页按钮并点击，或者滚动
            // 简单滚动:
            itemData.el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        };

        if (itemData.src === "PLACEHOLDER") {
            div.innerHTML = `<div class="ig-placeholder">VIDEO PREVIEW</div>`;
        } else {
            const img = document.createElement('img');
            img.src = itemData.src;
            div.appendChild(img);
        }

        if (itemData.isVideo) {
            const badge = document.createElement('div');
            badge.className = 'ig-side-video-badge';
            div.appendChild(badge);
        }
        return div;
    }

    function updateContainer(container, itemData) {
        const timerId = container.dataset.hideTimer;

        // 隐藏
        if (!itemData) {
            if (timerId || container.style.display === 'none') return;
            const tid = setTimeout(() => {
                container.style.opacity = '0';
                setTimeout(() => {
                    container.style.display = 'none';
                    container.dataset.activeKey = '';
                }, 200);
                container.removeAttribute('data-hide-timer');
            }, CONFIG.hideDelay);
            container.dataset.hideTimer = tid;
            return;
        }

        // 显示
        if (timerId) {
            clearTimeout(parseInt(timerId));
            container.removeAttribute('data-hide-timer');
        }

        const key = itemData.src;
        if (container.dataset.activeKey === key) {
            if (container.style.display === 'none') {
                container.style.display = 'flex';
                requestAnimationFrame(() => container.style.opacity = '1');
            } else {
                container.style.opacity = '1';
            }
            return;
        }

        // 更新内容
        const node = createPreview(itemData);
        container.innerHTML = '';
        if (node) container.appendChild(node);

        container.style.display = 'flex';
        requestAnimationFrame(() => container.style.opacity = '1');
        container.dataset.activeKey = key;
    }

    function renderAll(article) {
        const data = getMediaData(article);

        let leftC = article.querySelector('.ig-side-left');
        let rightC = article.querySelector('.ig-side-right');

        if (!leftC) {
            leftC = document.createElement('div');
            leftC.className = 'ig-side-container ig-side-left';
            article.style.position = 'relative';
            article.appendChild(leftC);
        }
        if (!rightC) {
            rightC = document.createElement('div');
            rightC.className = 'ig-side-container ig-side-right';
            article.style.position = 'relative';
            article.appendChild(rightC);
        }

        if (!data) {
            updateContainer(leftC, null);
            updateContainer(rightC, null);
            return;
        }

        updateContainer(leftC, data.left);
        updateContainer(rightC, data.right);
    }

    // 主处理函数（含防抖）
    const process = debounce(() => {
        // 【新增功能】宽高比检查
        // 如果 页面高度 > 页面宽度（竖屏模式），则禁用功能并隐藏已有的侧边栏
        if (window.innerHeight > window.innerWidth) {
            document.querySelectorAll('.ig-side-container').forEach(container => {
                container.style.opacity = '0';
                container.style.display = 'none';
                container.dataset.activeKey = ''; // 重置状态，确保恢复横屏时能重新渲染
            });
            return; // 停止执行后续渲染逻辑
        }

        // 如果宽度 > 高度，正常渲染
        document.querySelectorAll('article').forEach(renderAll);
    }, 50);

    // 强力监听
    const observer = new MutationObserver(() => {
        process();
    });

    observer.observe(document.body, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['style', 'src', 'class', 'transform']
    });

    // 监听 scroll 和 resize 都会触发 process，process 内部会自动判断宽高比
    window.addEventListener('scroll', process, { passive: true });
    window.addEventListener('resize', process);

    // 监听点击事件，如果用户点了下一页箭头，强制刷新
    document.addEventListener('click', (e) => {
        // IG 的箭头通常是 button 或 div
        if (e.target.closest('button') || e.target.role === 'button') {
            setTimeout(process, 50);
            setTimeout(process, 300); // 再次检查，防止动画未结束
        }
    }, true);

    process();

})();
