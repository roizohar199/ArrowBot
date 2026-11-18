// Copy from the raw captured frame, never from the preview canvas that has
// been annotated with selection outlines or candidate boxes.
export function copyFrameRectToCanvas(frame,box,makeCanvas=()=>document.createElement('canvas')) {
 if(!frame||!frame.data||!box||!Number.isInteger(box.x)||!Number.isInteger(box.y)||!Number.isInteger(box.width)||!Number.isInteger(box.height)||box.x<0||box.y<0||box.width<=0||box.height<=0||box.x+box.width>frame.width||box.y+box.height>frame.height)throw Error('INVALID_CROP');
 const canvas=makeCanvas();canvas.width=box.width;canvas.height=box.height;
 canvas.getContext('2d').putImageData(frame,-box.x,-box.y);
 return canvas;
}
