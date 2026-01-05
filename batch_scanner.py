#!/usr/bin/env python3
"""
Batch OCR Scanner for Label Images
Scans all images in pics folder and extracts label data
"""

import os
import re
import subprocess
import json

# Install pytesseract if needed
try:
    import pytesseract
    from PIL import Image
except ImportError:
    print("Installing required packages...")
    subprocess.run(['pip', 'install', 'pytesseract', 'pillow'], check=True)
    import pytesseract
    from PIL import Image

PICS_DIR = "/home/rishi/photo_identification/pics"

def parse_label_text(text):
    """Parse OCR text to extract batch, expiry, and MFG date - optimized for PepsiCo labels"""
    result = {
        'batch_no': '',
        'expiry_date': '',
        'mfg_date': '',
        'raw_text': text[:200] if text else ''
    }
    
    # Clean up text
    text_clean = text.replace('\n', ' ').upper()
    
    # Look for the structured line with dates and batch number
    # Format: "14/07/25 (DD/MM/YY) 12/04/26 (DD/MM/YY) 25-8902-0014"
    date_batch_pattern = r'(\d{2}/\d{2}/\d{2,4})\s*\([^)]+\)\s*(\d{2}/\d{2}/\d{2,4})\s*\([^)]+\)\s*(\d{2}-\d{4}-\d{4})'
    match = re.search(date_batch_pattern, text_clean)
    if match:
        result['mfg_date'] = match.group(1)
        result['expiry_date'] = match.group(2)
        result['batch_no'] = match.group(3)
        return result
    
    # Alternative: Look for batch numbers like 25-8902-0014 or 25-8902-0045
    batch_patterns = [
        r'(\d{2}-\d{4}-\d{4})',  # 25-8902-0014
        r'BATCH\s*NO\.?\s*[:\-]?\s*([A-Z0-9\-]+)',
        r'B\.?\s*NO\.?\s*[:\-]?\s*([A-Z0-9\-]+)',
    ]
    
    for pattern in batch_patterns:
        match = re.search(pattern, text_clean)
        if match:
            result['batch_no'] = match.group(1).strip()
            break
    
    # Look for dates in DD/MM/YY or DD/MM/YYYY format
    date_pattern = r'(\d{2}/\d{2}/\d{2,4})'
    dates = re.findall(date_pattern, text_clean)
    if len(dates) >= 2:
        result['mfg_date'] = dates[0]
        result['expiry_date'] = dates[1]
    elif len(dates) == 1:
        result['expiry_date'] = dates[0]
    
    return result

def scan_image(image_path):
    """OCR scan a single image"""
    try:
        img = Image.open(image_path)
        text = pytesseract.image_to_string(img)
        return parse_label_text(text)
    except Exception as e:
        return {'batch_no': '', 'expiry_date': '', 'mfg_date': '', 'error': str(e)}

def main():
    print("\n" + "="*80)
    print("🔍 BATCH OCR SCANNER - Scanning pics folder")
    print("="*80 + "\n")
    
    # Get all images
    images = sorted([f for f in os.listdir(PICS_DIR) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
    
    print(f"Found {len(images)} images to scan\n")
    
    results = []
    
    for i, img_name in enumerate(images, 1):
        img_path = os.path.join(PICS_DIR, img_name)
        print(f"[{i}/{len(images)}] Scanning: {img_name[:40]}...")
        
        result = scan_image(img_path)
        result['filename'] = img_name
        results.append(result)
    
    # Print results table
    print("\n" + "="*100)
    print("📋 SCAN RESULTS")
    print("="*100)
    print(f"{'#':<3} | {'Filename':<45} | {'Batch No':<15} | {'Expiry':<12} | {'MFG Date':<12}")
    print("-"*100)
    
    for i, r in enumerate(results, 1):
        fname = r['filename'][:42] + '...' if len(r['filename']) > 45 else r['filename']
        batch = r.get('batch_no', '-') or '-'
        exp = r.get('expiry_date', '-') or '-'
        mfg = r.get('mfg_date', '-') or '-'
        print(f"{i:<3} | {fname:<45} | {batch:<15} | {exp:<12} | {mfg:<12}")
    
    print("-"*100)
    
    # Summary
    with_batch = sum(1 for r in results if r.get('batch_no'))
    with_exp = sum(1 for r in results if r.get('expiry_date'))
    with_mfg = sum(1 for r in results if r.get('mfg_date'))
    
    print(f"\n📊 SUMMARY:")
    print(f"   Total Images: {len(results)}")
    print(f"   Batch No Found: {with_batch}/{len(results)}")
    print(f"   Expiry Found: {with_exp}/{len(results)}")
    print(f"   MFG Date Found: {with_mfg}/{len(results)}")
    print()

if __name__ == "__main__":
    main()
