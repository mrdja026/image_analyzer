# tagger.py
import nltk
from collections import Counter

nltk.download('punkt', quiet=True)

def auto_tag(text):
    tokens = nltk.word_tokenize(text.lower())
    freq = Counter(tokens)
    return [w for w,_ in freq.most_common(10)]
