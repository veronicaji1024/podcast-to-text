#!/usr/bin/env python3
"""
Faster-Whisper Transcription Script
High-performance local speech-to-text transcription
"""

import argparse
import sys
import os
import warnings

# Suppress warnings
warnings.filterwarnings('ignore')

def check_dependencies():
    """Check if required packages are installed"""
    try:
        import faster_whisper
        return True
    except ImportError:
        print("Error: faster-whisper not installed.")
        print("Please install it with: pip install faster-whisper")
        return False

def transcribe_audio(
    audio_path: str,
    output_path: str,
    model_size: str = "base",
    device: str = "cpu",
    compute_type: str = "int8",
    language: str = None,
    beam_size: int = 1,
    best_of: int = 1,
    temperature: float = 0.0,
    condition_on_previous_text: bool = True,
    initial_prompt: str = None,
    word_timestamps: bool = False,
    verbose: bool = True
):
    """
    Transcribe audio file using Faster-Whisper
    
    Args:
        audio_path: Path to audio file
        output_path: Path to save transcription
        model_size: Model size (tiny, base, small, medium, large-v1, large-v2, large-v3)
        device: Device to use (cpu, cuda)
        compute_type: Compute type (int8, int8_float16, int16, float16, float32)
        language: Language code (auto-detect if None)
        beam_size: Beam size for decoding
        best_of: Number of candidates when sampling
        temperature: Temperature for sampling
        condition_on_previous_text: Condition on previous text
        initial_prompt: Initial prompt to guide transcription
        word_timestamps: Include word-level timestamps
        verbose: Print progress
    """
    
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        print(f"Error importing faster_whisper: {e}")
        print("Please install: pip install faster-whisper")
        sys.exit(1)
    
    if verbose:
        print(f"Loading Faster-Whisper model: {model_size}")
        print(f"Device: {device}, Compute type: {compute_type}")
    
    # Load model
    try:
        model = WhisperModel(
            model_size,
            device=device,
            compute_type=compute_type,
            cpu_threads=os.cpu_count() if device == "cpu" else 4
        )
    except Exception as e:
        print(f"Error loading model: {e}")
        print("Trying with default settings...")
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
    
    if verbose:
        print(f"Transcribing: {audio_path}")
    
    # Transcribe
    segments, info = model.transcribe(
        audio_path,
        language=language,
        task="transcribe",
        beam_size=beam_size,
        best_of=best_of,
        temperature=temperature,
        condition_on_previous_text=condition_on_previous_text,
        initial_prompt=initial_prompt,
        word_timestamps=word_timestamps,
        vad_filter=True,  # Enable VAD for better accuracy
        vad_parameters=dict(min_silence_duration_ms=500)
    )
    
    if verbose:
        print(f"Detected language: {info.language} (probability: {info.language_probability:.2f})")
        print(f"Duration: {info.duration:.2f}s")
    
    # Collect transcription
    transcription_parts = []
    total_segments = 0
    
    for segment in segments:
        total_segments += 1
        
        # Format with timestamp if verbose
        if verbose:
            timestamp = f"[{format_time(segment.start)} --> {format_time(segment.end)}]"
            line = f"{timestamp} {segment.text.strip()}"
        else:
            line = segment.text.strip()
        
        transcription_parts.append(line)
        
        if verbose and total_segments % 10 == 0:
            print(f"Processed {total_segments} segments...", end='\r')
    
    if verbose:
        print(f"\nTotal segments: {total_segments}")
    
    # Join transcription
    full_transcription = '\n'.join(transcription_parts)
    
    # Save to file
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(full_transcription)
    
    if verbose:
        print(f"Transcription saved to: {output_path}")
        print(f"Total characters: {len(full_transcription)}")
    
    return full_transcription

def format_time(seconds: float) -> str:
    """Format seconds to HH:MM:SS.mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"

def main():
    parser = argparse.ArgumentParser(
        description='Transcribe audio using Faster-Whisper',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python whisper_transcribe.py audio.mp3 output.txt
  python whisper_transcribe.py audio.mp3 output.txt --model large-v2 --device cuda
  python whisper_transcribe.py audio.mp3 output.txt --language zh --compute_type float16
        """
    )
    
    parser.add_argument('audio', help='Path to audio file')
    parser.add_argument('output', help='Path to output transcription file')
    parser.add_argument('--model', default='base',
                       choices=['tiny', 'base', 'small', 'medium', 'large-v1', 'large-v2', 'large-v3'],
                       help='Model size (default: base)')
    parser.add_argument('--device', default='cpu',
                       choices=['cpu', 'cuda'],
                       help='Device to use (default: cpu)')
    parser.add_argument('--compute_type', default='int8',
                       choices=['int8', 'int8_float16', 'int16', 'float16', 'float32'],
                       help='Compute type (default: int8)')
    parser.add_argument('--language', default=None,
                       help='Language code (auto-detect if not specified)')
    parser.add_argument('--beam_size', type=int, default=1,
                       help='Beam size for decoding (default: 1)')
    parser.add_argument('--temperature', type=float, default=0.0,
                       help='Temperature for sampling (default: 0.0)')
    parser.add_argument('--word_timestamps', action='store_true',
                       help='Include word-level timestamps')
    parser.add_argument('--quiet', action='store_true',
                       help='Suppress output')
    
    args = parser.parse_args()
    
    # Check dependencies
    if not check_dependencies():
        sys.exit(1)
    
    # Check audio file exists
    if not os.path.exists(args.audio):
        print(f"Error: Audio file not found: {args.audio}")
        sys.exit(1)
    
    # Check output directory exists
    output_dir = os.path.dirname(args.output)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
    
    try:
        transcribe_audio(
            audio_path=args.audio,
            output_path=args.output,
            model_size=args.model,
            device=args.device,
            compute_type=args.compute_type,
            language=args.language,
            beam_size=args.beam_size,
            temperature=args.temperature,
            word_timestamps=args.word_timestamps,
            verbose=not args.quiet
        )
        print("Transcription completed successfully!")
        sys.exit(0)
        
    except Exception as e:
        print(f"Error during transcription: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
