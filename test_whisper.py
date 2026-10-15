from faster_whisper import WhisperModel


def main():
    """Test loading the speech recognition model"""
    model = WhisperModel(
        "tiny",
        device="cpu",
        compute_type="int8",
    )
    print("Модель загружена")


if __name__ == "__main__":
    main()
