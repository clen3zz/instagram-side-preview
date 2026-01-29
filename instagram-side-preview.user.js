// ==UserScript==
// @name         Instagram Side Preview (IG双侧预览)
// @namespace    https://github.com/clen3zz/
// @version      5.2
// @description  IG侧边预览：自动显示上一张/下一张。仅在INS主页生效，排除个人主页等子页面。
// @author       clen3zz
// @match        https://www.instagram.com/*
// @grant        GM_addStyle
// @run-at       document-idle
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

    function extractBestSource(container) {
        if (!container) return null;
        const imgs = Array.from(container.querySelectorAll('img'));
        const validImgs = imgs.filter(img => {
            const w = img.naturalWidth || img.clientWidth || 0;
            const alt = (img.alt || "").toLowerCase();
            if (alt.includes("profile") || alt.includes("avatar")) return false;
            return w > 150 || (img.src && img.src.length > 50);
        });

        if (validImgs.length > 0) {
            validImgs.sort((a, b) => {
                const wa = a.naturalWidth || 0;
                const wb = b.naturalWidth || 0;
                return wb - wa;
            });
            return { src: validImgs[0].src, isVideo: false, el: container };
        }

        const vid = container.querySelector('video');
        if (vid) {
            if (vid.poster && vid.poster.length > 10) {
                return { src: vid.poster, isVideo: true, el: container };
            }
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
            return { src: "PLACEHOLDER", isVideo: true, el: container };
        }
        return null;
    }

    // ================= 逻辑核心：容器锁定 =================

    function getMediaData(article) {
        let listItems = Array.from(article.querySelectorAll('ul li'));
        if (listItems.length < 2) {
            return getMediaDataGeometric(article);
        }

        const articleRect = article.getBoundingClientRect();
        const centerX = articleRect.left + articleRect.width / 2;

        let currentIndex = -1;
        let minDiff = Infinity;

        listItems.forEach((li, index) => {
            const rect = li.getBoundingClientRect();
            if (rect.width < 10 && rect.height < 10) return;
            const itemX = rect.left + rect.width / 2;
            const diff = Math.abs(itemX - centerX);
            if (diff < minDiff) {
                minDiff = diff;
                currentIndex = index;
            }
        });

        if (currentIndex === -1) return null;
        const prevLi = listItems[currentIndex - 1];
        const nextLi = listItems[currentIndex + 1];

        const leftData = prevLi ? extractBestSource(prevLi) : null;
        const rightData = nextLi ? extractBestSource(nextLi) : null;

        return { left: leftData, right: rightData };
    }

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

        lefts.sort((a,b) => b.rect.left - a.rect.left);
        rights.sort((a,b) => a.rect.left - b.rect.left);

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
        div.onclick = (e) => {
            e.stopPropagation();
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

    // ================= 主逻辑控制 =================

    // 辅助：清空所有预览，用于离开主页时
    function clearAllPreviews() {
        document.querySelectorAll('.ig-side-container').forEach(container => {
            container.style.opacity = '0';
            container.style.display = 'none';
            container.dataset.activeKey = '';
        });
    }

    // 主处理函数（含防抖）
    const process = debounce(() => {
        // 【核心修改点】1. URL 检查
        // window.location.pathname === '/' 代表只在主页生效
        // 这样当你点进个人主页（如 /clen3zz/）时，pathname 不为 /，就会触发清空逻辑
        if (window.location.pathname !== '/') {
            clearAllPreviews();
            return; // 停止执行后续渲染逻辑
        }

        // 【核心修改点】2. 宽高比检查（竖屏禁用）
        if (window.innerHeight > window.innerWidth) {
            clearAllPreviews();
            return;
        }

        // 3. 正常渲染
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

    window.addEventListener('scroll', process, { passive: true });
    window.addEventListener('resize', process);

    // 监听点击事件（兼容IG的SPA跳转）
    document.addEventListener('click', (e) => {
        // 无论是点击箭头，还是点击链接跳转，都触发一次检查
        // 延迟长一点是为了等待 URL 变化
        setTimeout(process, 50);
        setTimeout(process, 300);
    }, true);

    process();

})();
