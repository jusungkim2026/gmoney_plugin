"use strict";
// ============================================================
// Gmoney Design System Builder
// 임포트된 화면을 분석해서 피그마 컴포넌트로 자동 교체
// ============================================================
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
figma.showUI(__html__, { width: 400, height: 600 });
function scanComponents() {
    const result = [];
    const allComponents = figma.root.findAllWithCriteria({ types: ["COMPONENT"] });
    const processedSets = new Set();
    for (const comp of allComponents) {
        if (comp.parent && comp.parent.type === "COMPONENT_SET") {
            const setNode = comp.parent;
            if (!processedSets.has(setNode.id)) {
                processedSets.add(setNode.id);
                const variants = [];
                for (const child of setNode.children) {
                    if (child.type === "COMPONENT")
                        variants.push(child.name);
                }
                result.push({ id: setNode.id, name: setNode.name, type: "COMPONENT_SET", variants });
            }
        }
        else {
            result.push({ id: comp.id, name: comp.name, type: "COMPONENT", variants: [] });
        }
    }
    return result;
}
// ============================================================
// 2) 인스턴스 생성
// ============================================================
function createInstanceFromSet(setId, variantProps) {
    const node = figma.getNodeById(setId);
    if (!node || node.type !== "COMPONENT_SET")
        return null;
    const set = node;
    // 정확 매칭
    for (const child of set.children) {
        if (child.type !== "COMPONENT")
            continue;
        const parts = {};
        child.name.split(",").forEach((seg) => {
            const kv = seg.split("=").map((s) => s.trim());
            if (kv[0] && kv[1])
                parts[kv[0]] = kv[1];
        });
        if (Object.entries(variantProps).every(([k, v]) => parts[k] === v)) {
            return child.createInstance();
        }
    }
    // 부분 매칭
    let bestChild = null;
    let bestScore = 0;
    for (const child of set.children) {
        if (child.type !== "COMPONENT")
            continue;
        const score = Object.entries(variantProps).filter(([k, v]) => child.name.includes(k + "=" + v)).length;
        if (score > bestScore) {
            bestScore = score;
            bestChild = child;
        }
    }
    if (bestChild)
        return bestChild.createInstance();
    // 첫 번째 폴백
    for (const child of set.children) {
        if (child.type === "COMPONENT")
            return child.createInstance();
    }
    return null;
}
function createInstanceFromComponent(compId) {
    const node = figma.getNodeById(compId);
    if (!node || node.type !== "COMPONENT")
        return null;
    return node.createInstance();
}
// ============================================================
// 3) 시각적/구조적 컴포넌트 인식
// ============================================================
// 노드에서 fill 색상 추출
function getFillColor(node) {
    if (!("fills" in node))
        return null;
    const fills = node.fills;
    if (!fills || !Array.isArray(fills) || fills.length === 0)
        return null;
    const fill = fills[0];
    if (fill.type !== "SOLID")
        return null;
    const r = Math.round(fill.color.r * 255);
    const g = Math.round(fill.color.g * 255);
    const b = Math.round(fill.color.b * 255);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
// 노드의 border-radius 추출
function getCornerRadius(node) {
    if ("cornerRadius" in node) {
        const cr = node.cornerRadius;
        if (typeof cr === "number")
            return cr;
    }
    return 0;
}
// 노드의 텍스트 수집
function collectTexts(node) {
    const texts = [];
    if (node.type === "TEXT") {
        texts.push(node.characters);
    }
    if ("children" in node) {
        for (const child of node.children) {
            texts.push(...collectTexts(child));
        }
    }
    return texts;
}
// 자식 수 (직계)
function childCount(node) {
    if ("children" in node)
        return node.children.length;
    return 0;
}
// 자식 중 특정 색상 fill 가진 노드 찾기
function hasChildWithColor(node, targetColor) {
    if ("children" in node) {
        for (const child of node.children) {
            if (getFillColor(child) === targetColor)
                return true;
            if (hasChildWithColor(child, targetColor))
                return true;
        }
    }
    return false;
}
// 체크박스/라디오 패턴 찾기
function hasCheckboxPattern(node) {
    const texts = collectTexts(node);
    const hasAgreeLikeText = texts.some((t) => /agree|terms|privacy|marketing|select|동의|약관/i.test(t));
    return hasAgreeLikeText;
}
// 리스트 패턴 (반복되는 유사한 높이의 자식)
function hasListPattern(node) {
    if (!("children" in node))
        return false;
    const children = node.children;
    if (children.length < 3)
        return false;
    const heights = children.map((c) => Math.round(c.height));
    const sameHeight = heights.filter((h) => h === heights[0]).length;
    return sameHeight >= 3;
}
function detectComponentType(node) {
    const w = Math.round(node.width);
    const h = Math.round(node.height);
    const cr = getCornerRadius(node);
    const color = getFillColor(node);
    const texts = collectTexts(node);
    // --- Top Bar 감지 ---
    // 특성: 너비 ~360, 높이 ~52, 가로 레이아웃
    if (w >= 340 && w <= 380 && h >= 44 && h <= 60) {
        const variantProps = { type: "Default" };
        // 자식 분석으로 타입 결정
        const hasLogo = texts.some((t) => /logo/i.test(t));
        const hasClose = texts.some((t) => /close|닫기/i.test(t));
        if (hasLogo)
            variantProps.type = "Logo";
        else if (hasClose)
            variantProps.type = "close";
        return {
            nodeId: node.id, componentType: "Top Bar", variantProps,
            confidence: 85, x: node.x, y: node.y, width: w, height: h,
        };
    }
    // --- Button 감지 ---
    // 특성: border-radius >= 900 (pill), 높이 32-55, 배경색
    if (cr >= 90 && h >= 28 && h <= 60 && w >= 60) {
        const variantProps = {
            hierarchy: "primary", role: "brand", state: "default", size: "large",
        };
        // 크기
        if (h <= 36)
            variantProps.size = "small";
        else if (h <= 46)
            variantProps.size = "medium";
        // 색상으로 hierarchy/role 결정
        if (color === "#0047ff" || color === "#0039cc") {
            variantProps.hierarchy = "primary";
            variantProps.role = "brand";
            if (color === "#0039cc")
                variantProps.state = "pressed";
        }
        else if (color === "#ff2f54") {
            variantProps.hierarchy = "primary";
            variantProps.role = "error";
        }
        else if (color === "#ffffff" || color === "#f5f7fa") {
            variantProps.hierarchy = "secondary";
            variantProps.role = "weak";
        }
        return {
            nodeId: node.id, componentType: "Button", variantProps,
            confidence: 90, x: node.x, y: node.y, width: w, height: h,
        };
    }
    // --- Bottom Sheet 감지 ---
    // 특성: 너비 ~360, 상단만 라운드(16), 세로 레이아웃, 하단에 버튼
    if (w >= 340 && w <= 380 && h >= 150 && color === "#ffffff") {
        // 상단 라운드 체크
        const hasTopRound = cr >= 12;
        if (hasTopRound) {
            const variantProps = {
                contents: "Default", text: "header_body", button: "1_primary",
            };
            // 콘텐츠 타입 결정
            if (hasCheckboxPattern(node)) {
                const hasAllSelect = texts.some((t) => /all select|전체/i.test(t));
                variantProps.contents = hasAllSelect ? "Agree_all" : "Agree";
                variantProps.text = "header";
            }
            else if (hasListPattern(node)) {
                variantProps.contents = "List";
                variantProps.button = "Vertical";
            }
            else if (texts.some((t) => /permission|권한|camera|gallery/i.test(t))) {
                variantProps.contents = "Access";
                variantProps.text = "body";
            }
            else if (texts.some((t) => /confirm|확인|phone|전화/i.test(t))) {
                variantProps.contents = "Confirmation";
                variantProps.text = "header_body";
                variantProps.button = "2_horizon";
            }
            else if (texts.some((t) => /email|e-mail|입력/i.test(t))) {
                variantProps.contents = "Input_Field";
                variantProps.text = "header";
            }
            else if (texts.some((t) => /eng|kor|language|언어/i.test(t))) {
                variantProps.contents = "Select";
                variantProps.button = "2_horizon";
            }
            // 버튼 개수로 button 타입 결정
            const buttonLikeChildren = findButtonNodes(node);
            if (buttonLikeChildren.length >= 2) {
                variantProps.button = "2_horizon";
            }
            return {
                nodeId: node.id, componentType: "Bottom Sheet", variantProps,
                confidence: 80, x: node.x, y: node.y, width: w, height: h,
            };
        }
    }
    // --- Popup 감지 ---
    // 특성: 너비 ~280-330, 라운드 16, 세로 레이아웃, 버튼 포함
    if (w >= 260 && w <= 340 && h >= 120 && h <= 500 && cr >= 12 && color === "#ffffff") {
        const variantProps = {
            image: "Default", contents: "Default", text: "header_body", button: "1_primary",
        };
        // 이미지/아이콘 체크
        if (hasChildWithColor(node, "#e8f5e9") || hasChildWithColor(node, "#2e7d32")) {
            variantProps.image = "icon_check";
        }
        // 캘린더 패턴
        if (texts.some((t) => /calendar|달력|날짜|sun|mon|tue/i.test(t))) {
            variantProps.contents = "calendar";
        }
        // 버튼 분석
        const buttons = findButtonNodes(node);
        if (buttons.length >= 2) {
            variantProps.button = "2_horizon";
        }
        // 텍스트 구조
        if (texts.length <= 2) {
            variantProps.text = "header";
        }
        return {
            nodeId: node.id, componentType: "Popup", variantProps,
            confidence: 75, x: node.x, y: node.y, width: w, height: h,
        };
    }
    return null;
}
// 버튼처럼 생긴 자식 노드 찾기
function findButtonNodes(node) {
    const buttons = [];
    if ("children" in node) {
        for (const child of node.children) {
            const cr = getCornerRadius(child);
            if (cr >= 90 && child.height >= 28 && child.height <= 60) {
                buttons.push(child);
            }
            else {
                buttons.push(...findButtonNodes(child));
            }
        }
    }
    return buttons;
}
// 프레임 내 모든 컴포넌트 감지 (재귀)
function detectAllComponents(node, results) {
    const detected = detectComponentType(node);
    if (detected) {
        results.push(detected);
        return; // 매칭되면 자식 탐색 중단 (컴포넌트 단위로 교체)
    }
    // 매칭 안 되면 자식 탐색
    if ("children" in node) {
        for (const child of node.children) {
            detectAllComponents(child, results);
        }
    }
}
// ============================================================
// 5) 교체 실행
// ============================================================
function replaceWithComponent(detected, componentMap) {
    return __awaiter(this, void 0, void 0, function* () {
        const layerNode = figma.getNodeById(detected.nodeId);
        if (!layerNode || !layerNode.parent)
            return false;
        // 컴포넌트셋 찾기
        const nameLC = detected.componentType.toLowerCase().replace(/[\s_\-]/g, "");
        const matchedSet = componentMap.find((c) => c.type === "COMPONENT_SET" && c.name.toLowerCase().replace(/[\s_\-]/g, "") === nameLC);
        let instance = null;
        if (matchedSet) {
            instance = createInstanceFromSet(matchedSet.id, detected.variantProps);
        }
        else {
            const matchedComp = componentMap.find((c) => c.type === "COMPONENT" && c.name.toLowerCase().replace(/[\s_\-]/g, "") === nameLC);
            if (matchedComp)
                instance = createInstanceFromComponent(matchedComp.id);
        }
        if (!instance)
            return false;
        const parent = layerNode.parent;
        const index = parent.children.indexOf(layerNode);
        instance.x = layerNode.x;
        instance.y = layerNode.y;
        parent.insertChild(index, instance);
        layerNode.remove();
        return true;
    });
}
function buildScreen(spec, screenIndex) {
    return __awaiter(this, void 0, void 0, function* () {
        yield loadFonts();
        if (cachedComponents.length === 0)
            cachedComponents = scanComponents();
        const frame = figma.createFrame();
        frame.name = spec.name;
        frame.resize(spec.width, spec.height);
        frame.fills = [{ type: "SOLID", color: parseColor(spec.bg || "#ffffff") || { r: 1, g: 1, b: 1 } }];
        frame.layoutMode = "VERTICAL";
        frame.primaryAxisAlignItems = "MIN";
        frame.counterAxisAlignItems = "MIN";
        frame.itemSpacing = 0;
        frame.counterAxisSizingMode = "FIXED";
        frame.primaryAxisSizingMode = "FIXED";
        if (spec.padding) {
            frame.paddingTop = spec.padding.top;
            frame.paddingRight = spec.padding.right;
            frame.paddingBottom = spec.padding.bottom;
            frame.paddingLeft = spec.padding.left;
        }
        for (const el of spec.elements) {
            const node = yield createElementNode(el, spec.width - (spec.padding ? spec.padding.left + spec.padding.right : 0));
            if (node)
                frame.appendChild(node);
        }
        return frame;
    });
}
function createElementNode(el, parentWidth) {
    return __awaiter(this, void 0, void 0, function* () {
        // type 자동 감지 (없으면 componentName으로 판단)
        if (!el.type && el.componentName)
            el.type = "component";
        if (!el.type && el.text && !el.componentName)
            el.type = "text";
        // 여백
        if (el.type === "spacer") {
            const spacer = figma.createFrame();
            spacer.name = "spacer";
            spacer.resize(parentWidth, el.height || 16);
            spacer.fills = [];
            return spacer;
        }
        // 텍스트
        if (el.type === "text") {
            const wrapper = figma.createFrame();
            wrapper.name = el.text ? el.text.substring(0, 20) : "text";
            wrapper.fills = [];
            wrapper.layoutMode = "VERTICAL";
            wrapper.counterAxisSizingMode = "FIXED";
            wrapper.primaryAxisSizingMode = "AUTO";
            wrapper.resize(el.fillWidth !== false ? parentWidth : (el.width || parentWidth), 1);
            if (el.marginTop)
                wrapper.paddingTop = el.marginTop;
            const fw = el.fontWeight || 400;
            let font = DEFAULT_FONT;
            if (fw >= 700)
                font = BOLD_FONT;
            else if (fw >= 500)
                font = MEDIUM_FONT;
            yield figma.loadFontAsync(font);
            const textNode = figma.createText();
            textNode.fontName = font;
            textNode.characters = el.text || " ";
            textNode.fontSize = el.fontSize || 14;
            const color = parseColor(el.color || "#131720");
            if (color)
                textNode.fills = [{ type: "SOLID", color }];
            if (el.align)
                textNode.textAlignHorizontal = el.align;
            textNode.layoutAlign = "STRETCH";
            textNode.textAutoResize = "HEIGHT";
            wrapper.appendChild(textNode);
            return wrapper;
        }
        // DS 컴포넌트
        if (el.type === "component") {
            const nameLC = (el.componentName || "").toLowerCase().replace(/[\s_\-]/g, "");
            const matched = cachedComponents.find((c) => c.type === "COMPONENT_SET" && c.name.toLowerCase().replace(/[\s_\-]/g, "") === nameLC) || cachedComponents.find((c) => c.type === "COMPONENT" && c.name.toLowerCase().replace(/[\s_\-]/g, "") === nameLC);
            if (matched) {
                const instance = matched.type === "COMPONENT_SET"
                    ? createInstanceFromSet(matched.id, el.variantProps || {})
                    : createInstanceFromComponent(matched.id);
                if (instance) {
                    if (el.overrides) {
                        for (const [layerName, text] of Object.entries(el.overrides)) {
                            const textNodes = instance.findAll((n) => n.type === "TEXT" && n.name === layerName);
                            for (const tn of textNodes) {
                                try {
                                    yield figma.loadFontAsync(tn.fontName);
                                    tn.characters = text;
                                }
                                catch (e) { }
                            }
                        }
                    }
                    // 여백 처리
                    if (el.marginTop) {
                        const wrapper = figma.createFrame();
                        wrapper.name = el.componentName || "component";
                        wrapper.fills = [];
                        wrapper.layoutMode = "VERTICAL";
                        wrapper.counterAxisSizingMode = "AUTO";
                        wrapper.primaryAxisSizingMode = "AUTO";
                        wrapper.paddingTop = el.marginTop;
                        wrapper.appendChild(instance);
                        return wrapper;
                    }
                    return instance;
                }
            }
            return null;
        }
        // 커스텀 프레임 (인풋, 박스 등)
        if (el.type === "frame") {
            const f = figma.createFrame();
            f.name = el.text || "frame";
            f.resize(el.fillWidth !== false ? parentWidth : (el.width || parentWidth), el.height || 56);
            const bg = parseColor(el.bg || "");
            f.fills = bg ? [{ type: "SOLID", color: bg }] : [];
            if (el.borderRadius)
                f.cornerRadius = el.borderRadius;
            if (el.borderColor) {
                const bc = parseColor(el.borderColor);
                if (bc) {
                    f.strokes = [{ type: "SOLID", color: bc }];
                    f.strokeWeight = el.borderWidth || 1;
                }
            }
            if (el.padding) {
                f.paddingTop = el.padding;
                f.paddingRight = el.padding;
                f.paddingBottom = el.padding;
                f.paddingLeft = el.padding;
            }
            if (el.marginTop) {
                const wrapper = figma.createFrame();
                wrapper.name = "wrapper";
                wrapper.fills = [];
                wrapper.layoutMode = "VERTICAL";
                wrapper.counterAxisSizingMode = "AUTO";
                wrapper.primaryAxisSizingMode = "AUTO";
                wrapper.paddingTop = el.marginTop;
                wrapper.appendChild(f);
                return wrapper;
            }
            // 텍스트가 있으면 안에 배치
            if (el.text) {
                f.layoutMode = "HORIZONTAL";
                f.counterAxisAlignItems = "CENTER";
                f.primaryAxisAlignItems = "MIN";
                f.paddingLeft = el.padding || 16;
                f.paddingRight = el.padding || 16;
                const fw = el.fontWeight || 400;
                let font = DEFAULT_FONT;
                if (fw >= 700)
                    font = BOLD_FONT;
                else if (fw >= 500)
                    font = MEDIUM_FONT;
                yield figma.loadFontAsync(font);
                const tn = figma.createText();
                tn.fontName = font;
                tn.characters = el.text;
                tn.fontSize = el.fontSize || 16;
                const tc = parseColor(el.color || "#9aa5b8");
                if (tc)
                    tn.fills = [{ type: "SOLID", color: tc }];
                f.appendChild(tn);
            }
            return f;
        }
        // 가로 배치 (row)
        if (el.type === "row") {
            const row = figma.createFrame();
            row.name = "row";
            row.fills = [];
            row.layoutMode = "HORIZONTAL";
            row.counterAxisAlignItems = "CENTER";
            row.primaryAxisAlignItems = "CENTER";
            row.itemSpacing = el.gap || 8;
            row.counterAxisSizingMode = "AUTO";
            row.primaryAxisSizingMode = "FIXED";
            row.resize(parentWidth, 1);
            if (el.marginTop)
                row.paddingTop = el.marginTop;
            if (el.children) {
                for (const child of el.children) {
                    const childNode = yield createElementNode(child, parentWidth);
                    if (childNode)
                        row.appendChild(childNode);
                }
            }
            return row;
        }
        return null;
    });
}
function hexToRgb(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3)
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255,
    };
}
function parseColor(val) {
    if (!val)
        return null;
    val = val.trim();
    if (val.startsWith("#"))
        return hexToRgb(val);
    const rgb = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgb)
        return { r: +rgb[1] / 255, g: +rgb[2] / 255, b: +rgb[3] / 255 };
    return null;
}
function parseOpacity(val) {
    const m = val.match(/rgba?\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)/);
    return m ? parseFloat(m[1]) : 1;
}
function px(val) {
    if (!val)
        return 0;
    return parseFloat(val) || 0;
}
function parsePadding(val) {
    if (!val)
        return { top: 0, right: 0, bottom: 0, left: 0 };
    const parts = val.split(/\s+/).map((v) => px(v));
    if (parts.length === 1)
        return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
    if (parts.length === 2)
        return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
    if (parts.length === 3)
        return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
}
let DEFAULT_FONT = { family: "Roboto", style: "Regular" };
let BOLD_FONT = { family: "Roboto", style: "Bold" };
let MEDIUM_FONT = { family: "Roboto", style: "Medium" };
let fontsLoaded = false;
function loadFonts() {
    return __awaiter(this, void 0, void 0, function* () {
        if (fontsLoaded)
            return;
        // Roboto 시도
        try {
            yield figma.loadFontAsync({ family: "Roboto", style: "Regular" });
            yield figma.loadFontAsync({ family: "Roboto", style: "Bold" });
            yield figma.loadFontAsync({ family: "Roboto", style: "Medium" });
            DEFAULT_FONT = { family: "Roboto", style: "Regular" };
            BOLD_FONT = { family: "Roboto", style: "Bold" };
            MEDIUM_FONT = { family: "Roboto", style: "Medium" };
            fontsLoaded = true;
            return;
        }
        catch (e) { }
        // Inter 시도
        try {
            yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
            yield figma.loadFontAsync({ family: "Inter", style: "Bold" });
            yield figma.loadFontAsync({ family: "Inter", style: "Medium" });
            DEFAULT_FONT = { family: "Inter", style: "Regular" };
            BOLD_FONT = { family: "Inter", style: "Bold" };
            MEDIUM_FONT = { family: "Inter", style: "Medium" };
            fontsLoaded = true;
            return;
        }
        catch (e) { }
        // Arial 폴백
        try {
            yield figma.loadFontAsync({ family: "Arial", style: "Regular" });
            yield figma.loadFontAsync({ family: "Arial", style: "Bold" });
            DEFAULT_FONT = { family: "Arial", style: "Regular" };
            BOLD_FONT = { family: "Arial", style: "Bold" };
            MEDIUM_FONT = { family: "Arial", style: "Regular" };
            fontsLoaded = true;
        }
        catch (e) {
            figma.notify("폰트 로딩 실패 - 기본 폰트를 사용합니다");
        }
    });
}
// 시각적 속성이 있는지 (배경색, 보더, 보더라디우스)
function hasVisualProps(styles) {
    if (styles.backgroundColor && styles.backgroundColor !== "rgba(0, 0, 0, 0)" && styles.backgroundColor !== "transparent")
        return true;
    if (styles.borderWidth && parseFloat(styles.borderWidth) > 0)
        return true;
    if (styles.borderRadius && styles.borderRadius !== "0px")
        return true;
    if (styles.border && styles.border !== "none")
        return true;
    return false;
}
function buildFigmaFromTree(tree, name) {
    return __awaiter(this, void 0, void 0, function* () {
        yield loadFonts();
        const root = yield createFrameFromNode(tree);
        root.name = name;
        return root;
    });
}
function createFrameFromNode(node) {
    return __awaiter(this, void 0, void 0, function* () {
        const s = node.styles;
        const frame = figma.createFrame();
        frame.name = node.tag || "div";
        // 크기 (getBoundingClientRect 기반)
        const w = px(s.width);
        const h = px(s.height);
        if (w > 0 && h > 0)
            frame.resize(w, h);
        else if (w > 0)
            frame.resize(w, 10);
        else
            frame.resize(100, 10);
        // 절대 좌표
        if (typeof node.x === "number")
            frame.x = node.x;
        if (typeof node.y === "number")
            frame.y = node.y;
        // 배경색
        const bg = parseColor(s.backgroundColor || s.background || "");
        if (bg) {
            frame.fills = [{ type: "SOLID", color: bg, opacity: parseOpacity(s.backgroundColor || s.background || "") }];
        }
        else {
            frame.fills = [];
        }
        // border-radius
        const br = px(s.borderRadius);
        if (br > 0)
            frame.cornerRadius = Math.min(br, 999);
        // border
        const borderW = px(s.borderWidth || "0");
        if (borderW > 0) {
            const borderColor = parseColor(s.borderColor || "");
            if (borderColor) {
                frame.strokes = [{ type: "SOLID", color: borderColor }];
                frame.strokeWeight = borderW;
            }
        }
        // opacity
        if (s.opacity && s.opacity !== "1")
            frame.opacity = parseFloat(s.opacity) || 1;
        // 자식 노드 처리 (절대 좌표로 배치)
        for (const child of node.children) {
            if (child.tag === "svg") {
                const svgFrame = figma.createFrame();
                svgFrame.name = "svg";
                const svgW = px(child.styles.width) || 24;
                const svgH = px(child.styles.height) || 24;
                svgFrame.resize(svgW, svgH);
                svgFrame.fills = [{ type: "SOLID", color: { r: 0.89, g: 0.91, b: 0.94 } }];
                svgFrame.cornerRadius = 4;
                if (typeof child.x === "number")
                    svgFrame.x = child.x;
                if (typeof child.y === "number")
                    svgFrame.y = child.y;
                frame.appendChild(svgFrame);
            }
            else if (child.text && child.children.length === 0 && !hasVisualProps(child.styles)) {
                // 순수 텍스트 (배경/보더 없음) → 텍스트 노드만
                const textNode = yield createTextNodeAsync(child);
                if (typeof child.x === "number")
                    textNode.x = child.x;
                if (typeof child.y === "number")
                    textNode.y = child.y;
                const tw = px(child.styles.width);
                if (tw > 0) {
                    textNode.resize(tw, textNode.height);
                    textNode.textAutoResize = "HEIGHT";
                }
                frame.appendChild(textNode);
            }
            else {
                // 프레임 생성 (배경 있는 버튼/인풋/컨테이너 등)
                const childFrame = yield createFrameFromNode(child);
                frame.appendChild(childFrame);
            }
        }
        // 자신이 리프인 경우 텍스트 추가
        if (node.text && node.children.length === 0) {
            const textNode = yield createTextNodeAsync(node);
            // 프레임 안에서 센터링
            const cw = px(node.styles.width);
            const ch = px(node.styles.height);
            if (cw > 0) {
                textNode.resize(cw, textNode.height);
                textNode.textAutoResize = "HEIGHT";
            }
            // 텍스트 정렬이 center면 가운데
            if (node.styles.textAlign === "center") {
                textNode.textAlignHorizontal = "CENTER";
            }
            // 세로 가운데 배치
            if (ch > 0 && textNode.height < ch) {
                textNode.y = Math.round((ch - textNode.height) / 2);
            }
            frame.appendChild(textNode);
        }
        return frame;
    });
}
function createTextNodeAsync(node) {
    return __awaiter(this, void 0, void 0, function* () {
        const s = node.styles;
        const textNode = figma.createText();
        // 폰트 먼저 로드 후 텍스트 설정
        const fw = parseInt(s.fontWeight || "400");
        let font = DEFAULT_FONT;
        if (fw >= 700)
            font = BOLD_FONT;
        else if (fw >= 500)
            font = MEDIUM_FONT;
        try {
            yield figma.loadFontAsync(font);
        }
        catch (e) {
            // 폴백
            try {
                yield figma.loadFontAsync({ family: "Arial", style: "Regular" });
                font = { family: "Arial", style: "Regular" };
            }
            catch (e2) { }
        }
        textNode.fontName = font;
        textNode.characters = node.text || " ";
        textNode.name = node.text ? node.text.substring(0, 30) : "text";
        // 크기
        const fs = px(s.fontSize) || 14;
        textNode.fontSize = fs;
        // 색상
        const color = parseColor(s.color || "#131720");
        if (color)
            textNode.fills = [{ type: "SOLID", color }];
        // line-height
        if (s.lineHeight && s.lineHeight !== "normal") {
            const lh = px(s.lineHeight);
            if (lh > 0)
                textNode.lineHeight = { value: lh, unit: "PIXELS" };
        }
        // text-align
        if (s.textAlign === "center")
            textNode.textAlignHorizontal = "CENTER";
        else if (s.textAlign === "right")
            textNode.textAlignHorizontal = "RIGHT";
        // text-decoration
        if (s.textDecoration === "underline")
            textNode.textDecoration = "UNDERLINE";
        return textNode;
    });
}
// ============================================================
// 8) 초기화 및 메시지 핸들러
// ============================================================
let cachedComponents = [];
let importStartX = 0;
let importStartY = 0;
// 컴포넌트 스캔은 필요할 때만 (컴포넌트 입히기, 화면 조립 시)
figma.ui.postMessage({ action: "ready" });
// 선택 변경 감지
figma.on("selectionchange", () => {
    const sel = figma.currentPage.selection;
    if (sel.length === 1 && "children" in sel[0]) {
        const node = sel[0];
        const childCount = node.children.length;
        figma.ui.postMessage({
            action: "selection-changed",
            name: node.name,
            width: Math.round(node.width),
            height: Math.round(node.height),
            childCount,
        });
    }
    else {
        figma.ui.postMessage({ action: "selection-cleared" });
    }
});
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    // 재스캔
    if (msg.action === "scan") {
        cachedComponents = scanComponents();
        figma.ui.postMessage({ action: "scan-result", components: cachedComponents });
        figma.notify("컴포넌트 " + cachedComponents.length + "개 발견");
    }
    // ★ 컴포넌트 입히기 (메인 기능)
    if (msg.action === "apply-components") {
        const sel = figma.currentPage.selection;
        if (sel.length === 0) {
            figma.notify("프레임을 선택해주세요");
            figma.ui.postMessage({ action: "apply-error", message: "프레임을 선택해주세요" });
            return;
        }
        if (cachedComponents.length === 0) {
            cachedComponents = scanComponents();
        }
        const target = sel[0];
        const detected = [];
        detectAllComponents(target, detected);
        if (detected.length === 0) {
            figma.notify("매칭되는 컴포넌트를 찾지 못했습니다");
            figma.ui.postMessage({ action: "apply-result", found: 0, replaced: 0, details: [] });
            return;
        }
        let replaced = 0;
        const details = [];
        for (const d of detected) {
            const ok = yield replaceWithComponent(d, cachedComponents);
            if (ok)
                replaced++;
            details.push({
                type: d.componentType,
                variant: Object.entries(d.variantProps).map(([k, v]) => k + "=" + v).join(", "),
                success: ok,
            });
        }
        figma.notify("✅ " + replaced + "/" + detected.length + "개 컴포넌트 교체 완료");
        figma.ui.postMessage({ action: "apply-result", found: detected.length, replaced, details });
    }
    // 미리보기 (교체 전 감지 결과 확인)
    if (msg.action === "preview-matches") {
        const sel = figma.currentPage.selection;
        if (sel.length === 0) {
            figma.ui.postMessage({ action: "preview-result", matches: [] });
            return;
        }
        const target = sel[0];
        const detected = [];
        detectAllComponents(target, detected);
        const matches = detected.map((d) => {
            const nameLC = d.componentType.toLowerCase().replace(/[\s_\-]/g, "");
            const hasMatch = cachedComponents.some((c) => c.name.toLowerCase().replace(/[\s_\-]/g, "") === nameLC);
            return {
                componentType: d.componentType,
                variantString: Object.entries(d.variantProps).map(([k, v]) => k + "=" + v).join(", "),
                confidence: d.confidence,
                hasMatch,
                width: d.width,
                height: d.height,
            };
        });
        figma.ui.postMessage({ action: "preview-result", matches });
    }
    // 화면 조립
    if (msg.action === "build-by-name") {
        const spec = msg.spec;
        const screenIndex = msg.screenIndex || 0;
        const totalScreens = msg.totalScreens || 1;
        try {
            if (cachedComponents.length === 0)
                cachedComponents = scanComponents();
            // 디버그: Popup 매칭 확인
            const popupComps = cachedComponents.filter((c) => c.name.toLowerCase().includes("popup"));
            figma.notify("Popup 관련: " + popupComps.map((c) => c.name + "(" + c.type + ")").join(", "), { timeout: 8000 });
            const frame = yield buildScreen(spec, screenIndex);
            if (screenIndex === 0) {
                const center = figma.viewport.center;
                importStartX = Math.round(center.x);
                importStartY = Math.round(center.y);
            }
            frame.x = importStartX + screenIndex * (spec.width + 40);
            frame.y = importStartY;
            figma.currentPage.appendChild(frame);
            if (screenIndex === totalScreens - 1) {
                const allFrames = [];
                for (let i = 0; i <= screenIndex; i++) {
                    const n = figma.currentPage.children[figma.currentPage.children.length - 1 - (screenIndex - i)];
                    if (n)
                        allFrames.push(n);
                }
                figma.viewport.scrollAndZoomIntoView(allFrames);
            }
            figma.notify("✅ (" + (screenIndex + 1) + "/" + totalScreens + ") " + spec.name);
            figma.ui.postMessage({ action: "build-by-name-result", placed: spec.elements.length, total: spec.elements.length });
        }
        catch (e) {
            figma.notify("조립 실패: " + (e.message || e) + " / " + (e.stack || "").substring(0, 150), { timeout: 10000 });
            figma.ui.postMessage({ action: "build-by-name-result", placed: 0, total: 0 });
        }
    }
    // ★ 하이브리드 임포트 (이미지 + 텍스트 오버레이)
    if (msg.action === "hybrid-import") {
        const { imageBase64, width, height, texts, zones, name, screenIndex, totalScreens } = msg;
        try {
            yield loadFonts();
            // 1) base64 → Uint8Array
            const raw = figma.base64Decode(imageBase64);
            // 2) 이미지 생성
            const image = figma.createImage(raw);
            // 3) 프레임 생성 + 이미지 배경
            const frame = figma.createFrame();
            frame.name = name || "Imported Screen";
            frame.resize(width, height);
            frame.fills = [{
                    type: "IMAGE",
                    imageHash: image.hash,
                    scaleMode: "FILL",
                }];
            // 4) 텍스트 오버레이 (편집 가능)
            if (texts && texts.length > 0) {
                for (const t of texts) {
                    try {
                        const fw = t.fontWeight || 400;
                        let font = DEFAULT_FONT;
                        if (fw >= 700)
                            font = BOLD_FONT;
                        else if (fw >= 500)
                            font = MEDIUM_FONT;
                        yield figma.loadFontAsync(font);
                        const textNode = figma.createText();
                        textNode.fontName = font;
                        textNode.characters = t.text;
                        textNode.fontSize = t.fontSize || 14;
                        textNode.name = t.text.substring(0, 30);
                        const color = parseColor(t.color || "#131720");
                        if (color)
                            textNode.fills = [{ type: "SOLID", color }];
                        if (t.textAlign === "center")
                            textNode.textAlignHorizontal = "CENTER";
                        else if (t.textAlign === "right")
                            textNode.textAlignHorizontal = "RIGHT";
                        textNode.x = t.x;
                        textNode.y = t.y;
                        if (t.width > 0) {
                            textNode.resize(t.width, t.height || textNode.height);
                            textNode.textAutoResize = "HEIGHT";
                        }
                        // 텍스트를 보이지 않게 (이미지 위에 겹침) - 투명하게 설정
                        textNode.opacity = 0;
                        frame.appendChild(textNode);
                    }
                    catch (e) {
                        // 개별 텍스트 실패 무시
                    }
                }
            }
            // 5) 인터랙티브 존 (버튼/인풋 — 컴포넌트 교체용 투명 프레임)
            if (zones && zones.length > 0) {
                for (const z of zones) {
                    const zone = figma.createFrame();
                    zone.name = (z.tag === "button" ? "Button" : z.tag === "input" ? "Input" : "Zone") + " / " + (z.text || z.placeholder || "interactive");
                    zone.resize(z.width, z.height);
                    zone.x = z.x;
                    zone.y = z.y;
                    zone.fills = []; // 투명
                    zone.strokes = []; // 보더 없음
                    zone.opacity = 0; // 완전 투명 (선택은 가능)
                    frame.appendChild(zone);
                }
            }
            // 6) 위치 배치 (왼쪽→오른쪽 나열)
            if (screenIndex === 0) {
                const center = figma.viewport.center;
                importStartX = Math.round(center.x);
                importStartY = Math.round(center.y);
            }
            frame.x = importStartX + screenIndex * (width + 40);
            frame.y = importStartY;
            figma.currentPage.appendChild(frame);
            if (screenIndex === totalScreens - 1) {
                const allFrames = [];
                for (let i = 0; i <= screenIndex; i++) {
                    const n = figma.currentPage.children[figma.currentPage.children.length - 1 - (screenIndex - i)];
                    if (n)
                        allFrames.push(n);
                }
                figma.viewport.scrollAndZoomIntoView(allFrames);
            }
            figma.notify("✅ (" + (screenIndex + 1) + "/" + totalScreens + ") " + name);
            figma.ui.postMessage({ action: "import-html-done", success: true, name });
        }
        catch (e) {
            figma.notify("임포트 실패: " + e.message);
            figma.ui.postMessage({ action: "import-html-done", success: false, error: e.message });
        }
    }
    // HTML 가져오기 (기존 방식 폴백)
    if (msg.action === "import-html") {
        const tree = msg.tree;
        const name = msg.name || "Imported Screen";
        const screenIndex = msg.screenIndex || 0;
        const totalScreens = msg.totalScreens || 1;
        try {
            const frame = yield buildFigmaFromTree(tree, name);
            // 첫 화면은 뷰포트 중앙, 이후는 오른쪽으로 나열 (간격 40px)
            if (screenIndex === 0) {
                const center = figma.viewport.center;
                importStartX = Math.round(center.x);
                importStartY = Math.round(center.y);
            }
            frame.x = importStartX + screenIndex * (Math.round(frame.width) + 40);
            frame.y = importStartY;
            figma.currentPage.appendChild(frame);
            // 마지막 화면이면 전체를 뷰에 맞추기
            if (screenIndex === totalScreens - 1) {
                const allFrames = [];
                for (let i = 0; i <= screenIndex; i++) {
                    const n = figma.currentPage.children[figma.currentPage.children.length - 1 - (screenIndex - i)];
                    if (n)
                        allFrames.push(n);
                }
                figma.viewport.scrollAndZoomIntoView(allFrames);
            }
            figma.notify("✅ (" + (screenIndex + 1) + "/" + totalScreens + ") " + name);
            figma.ui.postMessage({ action: "import-html-done", success: true, name });
        }
        catch (e) {
            figma.notify("임포트 실패: " + e.message);
            figma.ui.postMessage({ action: "import-html-done", success: false, error: e.message });
        }
    }
    // ★ MCP 브릿지 명령 처리
    if (msg.action === "mcp-command") {
        const cmd = msg.command;
        const cmdId = cmd.id;
        try {
            let result = {};
            // 컴포넌트 목록 조회
            if (cmd.action === "list-components") {
                if (cachedComponents.length === 0)
                    cachedComponents = scanComponents();
                result = cachedComponents.map((c) => ({ name: c.name, type: c.type, variants: c.variants.length }));
            }
            // 화면 조립
            else if (cmd.action === "build-screen") {
                if (cachedComponents.length === 0)
                    cachedComponents = scanComponents();
                const spec = cmd.spec;
                const screenIndex = cmd.screenIndex || 0;
                const frame = yield buildScreen(spec, screenIndex);
                if (screenIndex === 0) {
                    const center = figma.viewport.center;
                    importStartX = Math.round(center.x);
                    importStartY = Math.round(center.y);
                }
                frame.x = importStartX + screenIndex * (spec.width + 40);
                frame.y = importStartY;
                figma.currentPage.appendChild(frame);
                figma.viewport.scrollAndZoomIntoView([frame]);
                result = { success: true, name: spec.name, nodeId: frame.id };
                figma.notify("✅ " + spec.name + " 생성 완료");
            }
            // 컴포넌트 인스턴스 배치
            else if (cmd.action === "place-component") {
                if (cachedComponents.length === 0)
                    cachedComponents = scanComponents();
                const nameLC = (cmd.componentName || "").toLowerCase().replace(/[\s_\-]/g, "");
                const matched = cachedComponents.find((c) => c.type === "COMPONENT_SET" && c.name.toLowerCase().replace(/[\s_\-]/g, "") === nameLC) || cachedComponents.find((c) => c.type === "COMPONENT" && c.name.toLowerCase().replace(/[\s_\-]/g, "") === nameLC);
                if (matched) {
                    const instance = matched.type === "COMPONENT_SET"
                        ? createInstanceFromSet(matched.id, cmd.variantProps || {})
                        : createInstanceFromComponent(matched.id);
                    if (instance) {
                        if (cmd.x !== undefined)
                            instance.x = cmd.x;
                        if (cmd.y !== undefined)
                            instance.y = cmd.y;
                        figma.currentPage.appendChild(instance);
                        result = { success: true, nodeId: instance.id };
                    }
                }
                else {
                    result = { success: false, error: "컴포넌트를 찾을 수 없습니다: " + cmd.componentName };
                }
            }
            // 노드 상세 정보 (자식 포함)
            else if (cmd.action === "inspect-node") {
                const sel = figma.currentPage.selection;
                if (sel.length === 0) {
                    result = { error: "선택된 노드 없음" };
                }
                else {
                    const inspectNode = (n, depth) => {
                        const info = {
                            id: n.id, name: n.name, type: n.type,
                            width: Math.round(n.width), height: Math.round(n.height),
                            x: Math.round(n.x), y: Math.round(n.y),
                        };
                        // fills
                        if ("fills" in n && Array.isArray(n.fills) && n.fills.length > 0) {
                            const f = n.fills[0];
                            if (f.type === "SOLID") {
                                info.fill = "#" + [f.color.r, f.color.g, f.color.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
                            }
                        }
                        // corner radius
                        if ("cornerRadius" in n && typeof n.cornerRadius === "number") {
                            info.cornerRadius = n.cornerRadius;
                        }
                        // text
                        if (n.type === "TEXT") {
                            const tn = n;
                            info.characters = tn.characters;
                            info.fontSize = tn.fontSize;
                            info.fontName = tn.fontName;
                            info.fontWeight = typeof tn.fontWeight === "number" ? tn.fontWeight : undefined;
                            info.textAlignHorizontal = tn.textAlignHorizontal;
                            info.lineHeight = tn.lineHeight;
                        }
                        // auto layout
                        if ("layoutMode" in n) {
                            const frame = n;
                            if (frame.layoutMode !== "NONE") {
                                info.layoutMode = frame.layoutMode;
                                info.itemSpacing = frame.itemSpacing;
                                info.paddingTop = frame.paddingTop;
                                info.paddingRight = frame.paddingRight;
                                info.paddingBottom = frame.paddingBottom;
                                info.paddingLeft = frame.paddingLeft;
                            }
                        }
                        // opacity
                        if ("opacity" in n && n.opacity !== 1) {
                            info.opacity = n.opacity;
                        }
                        // strokes
                        if ("strokes" in n && Array.isArray(n.strokes) && n.strokes.length > 0) {
                            const s = n.strokes[0];
                            if (s.type === "SOLID") {
                                info.stroke = "#" + [s.color.r, s.color.g, s.color.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
                                info.strokeWeight = n.strokeWeight;
                            }
                        }
                        // children (depth 제한)
                        if ("children" in n && depth < 3) {
                            info.children = n.children.map((c) => inspectNode(c, depth + 1));
                        }
                        return info;
                    };
                    result = sel.map((n) => inspectNode(n, 0));
                }
            }
            // 현재 선택 정보 (variant 상세 포함)
            else if (cmd.action === "get-selection") {
                const sel = figma.currentPage.selection;
                result = sel.map((n) => {
                    const info = { id: n.id, name: n.name, type: n.type, width: Math.round(n.width), height: Math.round(n.height) };
                    if (n.type === "COMPONENT_SET") {
                        const set = n;
                        info.variants = set.children.map((c) => c.name);
                        // variant property 키/값 추출
                        const propKeys = {};
                        for (const child of set.children) {
                            child.name.split(",").forEach((seg) => {
                                const kv = seg.split("=").map((s) => s.trim());
                                if (kv[0] && kv[1]) {
                                    if (!propKeys[kv[0]])
                                        propKeys[kv[0]] = new Set();
                                    propKeys[kv[0]].add(kv[1]);
                                }
                            });
                        }
                        info.properties = {};
                        for (const [k, v] of Object.entries(propKeys)) {
                            info.properties[k] = Array.from(v);
                        }
                    }
                    else if (n.type === "COMPONENT") {
                        info.variantName = n.name;
                    }
                    return info;
                });
            }
            figma.ui.postMessage({ action: "mcp-result", commandId: cmdId, result });
        }
        catch (e) {
            figma.ui.postMessage({ action: "mcp-result", commandId: cmdId, result: { error: e.message } });
        }
    }
    // 인스턴스 배치
    if (msg.action === "place-instance") {
        const { setId, compId, variantProps } = msg;
        let instance = null;
        if (setId)
            instance = createInstanceFromSet(setId, variantProps || {});
        else if (compId)
            instance = createInstanceFromComponent(compId);
        if (instance) {
            const center = figma.viewport.center;
            instance.x = center.x;
            instance.y = center.y;
            figma.currentPage.appendChild(instance);
            figma.viewport.scrollAndZoomIntoView([instance]);
            figma.notify("✅ 인스턴스 배치 완료");
        }
        else {
            figma.notify("컴포넌트를 찾을 수 없습니다");
        }
    }
});
