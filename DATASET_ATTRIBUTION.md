# Dataset attribution

## 1. FruitNet (6 fruits)

The local model training data and the six web preview photos are from:

> Meshram, Vishal; Patil, Kailas. *FruitNet: Indian fruits image dataset with quality for machine learning applications*. Mendeley Data, Version 3, 2022. https://doi.org/10.17632/b6fftwbr2v.3. Related paper: https://doi.org/10.1016/j.dib.2021.107686.

The dataset source describes real mobile-phone photographs of apple, banana, guava, lime, orange, and pomegranate. Its labels are Good, Bad, and Mixed. The Kaggle mirror used for the local download lists its license as **CC BY-SA 4.0**; attribution is retained here and in the model README. The six JPEG previews are re-encoded selections from the source photos; the full archive and extracted dataset stay in the ignored local `ai-service/data/` directory.

The trained weights and selected preview photos are shared under CC BY-SA 4.0 as the declared mirror license requires. Source dataset labels remain credited to the original authors. Preview listing quantities and token prices are local test values and are not present in the source dataset.

## 2. Fresh/rotten fruit & vegetable set (7 more crops)

Additional training photos (mango, tomato, potato, strawberry, bell pepper, cucumber, carrot — fresh/rotten only, no Mixed) come from:

> muhriddinmuxiddinov. *Fruits and Vegetables dataset: Determining freshness of fruits and vegetables*. Kaggle mirror, **CC0 public domain**: https://www.kaggle.com/datasets/muhriddinmuxiddinov/fruits-and-vegetables-dataset

Fresh maps to Good and rotten maps to Bad in our three-class scheme; the Mixed class remains FruitNet-sourced. Four more preview photos (mango, tomato, potato, strawberry) are re-encoded selections from these photos.
