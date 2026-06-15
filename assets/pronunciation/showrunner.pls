<?xml version="1.0" encoding="UTF-8"?>
<!--
  Showrunner domain pronunciation dictionary (PLS 1.0, for ElevenLabs).

  Upload once to ElevenLabs, then record the returned ids in demo.yaml under:
    voiceover.provider.pronunciation_dictionary_id
    voiceover.provider.pronunciation_dictionary_version_id
  Re-uploading (after editing this file) yields a new version_id; recording it
  in config busts the master freeze key automatically, so audio re-casts.

  Out of scope here (handled upstream, do NOT duplicate):
    - GH¢ / $ amounts  → normalization pre-pass (numberToWords)
    - all-caps acronyms like SAR → normalization acronym rule ("S A R")

  TODO — add only once the team confirms the intended pronunciation
  (left out rather than guessed): Eduwaka, Argus.
-->
<lexicon version="1.0"
  xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
  alphabet="cmu-arpabet" xml:lang="en-US">
  <lexeme>
    <grapheme>Credstone</grapheme>
    <phoneme>K R EH1 D S T OW0 N</phoneme>
  </lexeme>
  <lexeme>
    <grapheme>BoG</grapheme>
    <alias>Bank of Ghana</alias>
  </lexeme>
  <lexeme>
    <grapheme>goAML</grapheme>
    <alias>go A M L</alias>
  </lexeme>
</lexicon>
