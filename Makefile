PYTHON ?= python3
BASE ?= http://localhost:8000/
PORT ?= 8000

.PHONY: install test validate build serve refresh update check clean

install:
	$(PYTHON) -m pip install -r requirements.txt

test:
	$(PYTHON) -m unittest discover -s pipeline/tests -v

validate:
	$(PYTHON) pipeline/validate.py

build:
	PA_BASE_URL=$(BASE) $(PYTHON) pipeline/build_site_data.py --out site_dist

serve:
	$(PYTHON) -m http.server $(PORT) --directory site_dist

refresh:
	$(PYTHON) pipeline/refresh.py

update:
	bash deploy/update.sh

check: test validate build

clean:
	rm -rf site_dist site_dist.tmp .cache
	find . -name '__pycache__' -type d -prune -exec rm -rf {} +
	find . -name '*.pyc' -delete
