.PHONY: deploy-landing deploy-landing-force

## Deploy landing/ to gh-pages branch
deploy-landing:
	git add landing/ && git commit -m "update landing page" || true
	git subtree push --prefix landing origin gh-pages

## Force deploy (use when subtree push fails due to history conflict)
deploy-landing-force:
	git add landing/ && git commit -m "update landing page" || true
	git subtree split --prefix landing -b gh-pages-tmp
	git push origin gh-pages-tmp:gh-pages --force
	git branch -D gh-pages-tmp


#   - make deploy-landing — 正常部署
#   - make deploy-landing-force — 历史冲突时强制部署
