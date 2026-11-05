(function installTeacherReportExport() {
  'use strict';

  const width = 794;
  const height = 1123;
  const scale = 2;
  const quality = .85;
  const pdfLimit = 3 * 1024 * 1024;
  const vendor = '/public/vendor/report-export/';
  let libraries;
  let queue = Promise.resolve();

  function loadScript(name) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = vendor + name;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => {
        script.remove();
        reject(new Error('보고서 출력 도구를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'));
      }, { once: true });
      document.head.append(script);
    });
  }

  function loadLibraries() {
    if (!libraries) {
      libraries = Promise.all([loadScript('html2canvas-1.4.1.min.js'), loadScript('jspdf-4.2.1.umd.min.js')])
        .then(() => {
          if (typeof window.html2canvas !== 'function' || window.jspdf?.jsPDF?.version !== '4.2.1') {
            throw new Error('보고서 출력 도구의 버전을 확인할 수 없습니다.');
          }
          return { capture: window.html2canvas, PDF: window.jspdf.jsPDF };
        }).catch(error => { libraries = undefined; throw error; });
    }
    return libraries;
  }

  function fileStem(report) {
    const identity = [report.student?.학번, report.student?.이름].filter(Boolean).join('_')
      .replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').trim().slice(0, 85);
    return (identity || '기록_요약') + '_' + report.start + '_' + report.end;
  }

  function fitIntakes(page) {
    const table = page.querySelector('.summary-intakes table');
    const rows = [...(table?.tBodies[0]?.rows || [])];
    if (!rows.length) return;
    const container = table.closest('.summary-intakes');
    const note = page.ownerDocument.createElement('p');
    note.className = 'summary-note export-intake-note';
    container.after(note);
    // Show the most recent entries that fit on the page; the on-screen report keeps the full table.
    let hidden = 0;
    function omitFirst() {
      rows[hidden++].remove();
      note.textContent = '최근 ' + (rows.length - hidden) + '건 표시 · 나머지 ' + hidden + '건은 앱의 기록 화면에서 확인할 수 있어요.';
    }
    while (rows.length - hidden > 8) omitFirst();
    while (page.scrollHeight > height + 1 && rows.length - hidden > 1) omitFirst();
    if (!hidden) note.remove();
  }

  async function capturePages(report, capture) {
    const { styles, content } = window.teacherReportFiles.buildSummaryReportDocument(report);
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none`;
    document.body.append(frame);
    try {
      const doc = frame.contentDocument;
      doc.open();
      doc.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>' + styles + `
        html,body{margin:0;padding:0;width:${width}px}
        .summary-report{display:block;width:${width}px}
        .summary-page{width:${width}px;height:${height}px;min-height:${height}px;border-radius:0;box-shadow:none;overflow:visible}
        .summary-page>*{flex-shrink:0}
        .summary-intakes,.summary-page[data-late="true"] .summary-intakes{max-height:none;overflow:visible}
        .export-intake-note{margin-top:-4px!important}
        </style></head><body>` + content + '</body></html>');
      doc.close();
      await doc.fonts.ready;
      const pages = [...doc.querySelectorAll('.summary-page')];
      if (pages.length !== 2) throw new Error('출력할 보고서가 두 쪽인지 확인해 주세요.');
      const files = [];
      for (const [index, page] of pages.entries()) {
        fitIntakes(page);
        const sourceHeight = Math.max(height, page.scrollHeight);
        // Long week tables can use more vertical space before fitting into the same A4 image.
        const heightLimit = page.dataset.size === 'many-weeks' ? 2 : 1.5;
        if (sourceHeight > height * heightLimit) throw new Error('보고서가 두 쪽에 담기 어렵습니다. 기간이나 교사 메모를 줄여 주세요.');
        const source = await capture(page, {
          width, height: sourceHeight, windowWidth: width, windowHeight: sourceHeight,
          scale, backgroundColor: '#ffffff', logging: false, allowTaint: false, useCORS: false,
        });
        let canvas = source;
        try {
          if (source.height !== height * scale || source.width !== width * scale) {
            // Preserve unusually long prose without cropping, while keeping a true A4 image.
            canvas = doc.createElement('canvas');
            canvas.width = width * scale;
            canvas.height = height * scale;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const ratio = Math.min(canvas.width / source.width, canvas.height / source.height);
            const drawnWidth = source.width * ratio;
            ctx.drawImage(source, (canvas.width - drawnWidth) / 2, 0, drawnWidth, source.height * ratio);
          }
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
          if (!blob || blob.type !== 'image/jpeg') throw new Error('보고서 이미지를 만들지 못했습니다.');
          files.push({ name: `${fileStem(report)}_${index + 1}쪽.jpg`, bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type });
        } finally {
          source.width = 0;
          if (canvas !== source) canvas.width = 0;
        }
      }
      return files;
    } finally {
      frame.remove();
    }
  }

  function checkPdf(bytes) {
    if (bytes.length > pdfLimit) throw new Error('PDF가 3MB를 넘습니다. 기간을 줄여 다시 만들어 주세요.');
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('PDF 형식을 확인할 수 없습니다.');
  }

  function toPdf(PDF, report, images) {
    const pdf = new PDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    for (const [index, image] of images.entries()) {
      if (index) pdf.addPage('a4', 'portrait');
      pdf.addImage(image.bytes, 'JPEG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
    }
    const bytes = new Uint8Array(pdf.output('arraybuffer'));
    checkPdf(bytes);
    return { name: fileStem(report) + '.pdf', bytes, type: 'application/pdf' };
  }

  function prepare(report, kind = 'pdf') {
    const work = queue.then(async () => {
      if (!report?.feedback?.engine) throw new Error('먼저 피드백을 만들어 주세요.');
      const { capture, PDF } = await loadLibraries();
      const images = await capturePages(report, capture);
      return kind === 'images' ? images : [toPdf(PDF, report, images)];
    });
    queue = work.catch(() => {});
    return work;
  }

  function deliveryRequest(report, file, deliveryId) {
    checkPdf(file.bytes);
    let binary = '';
    for (let index = 0; index < file.bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...file.bytes.subarray(index, index + 0x8000));
    }
    return { pdf: btoa(binary), fileName: file.name, start: report.start, end: report.end, deliveryId,
      studentId: report.student.학번, studentName: report.student.이름 };
  }

  function download(file) {
    const url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function offerImageDownloads(files) {
    // Some browsers block the second programmatic download; give each page its own link.
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', '보고서 이미지 저장');
    dialog.style.cssText = 'border:1px solid #dbe4f0;border-radius:14px;padding:18px;color:#1f2a44;max-width:calc(100% - 32px)';
    const label = document.createElement('p');
    label.textContent = '1쪽과 2쪽을 각각 저장할 수 있습니다.';
    dialog.append(label);
    const urls = files.map((file, index) => {
      const url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }));
      const link = document.createElement('a');
      link.className = 'btn';
      link.href = url;
      link.download = file.name;
      link.textContent = (index + 1) + '쪽 이미지 저장';
      dialog.append(link, document.createTextNode(' '));
      return url;
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn';
    close.textContent = '닫기';
    close.addEventListener('click', () => dialog.close());
    dialog.append(close);
    dialog.addEventListener('close', () => {
      setTimeout(() => urls.forEach(url => URL.revokeObjectURL(url)), 60000);
      dialog.remove();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }

  window.teacherReportExport = { prepare, deliveryRequest, download, offerImageDownloads };
}());
