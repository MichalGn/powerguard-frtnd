#Przygotowanie 
#rm -rf dist
#npm run build --prod   //uruchomienie wersji produkcyjnej

#Wyczyszczenie pamieci w Angularze
#npm cache clean --force
#rm -rf node_modules/
#rm package-lock.json
#npm install

#sudo docker build -t powerguard-frtnd_image .
#sudo docker build -t powerguard-frtnd_image:1.0.0 .

#sudo docker save -o powerguard-frtnd-261017.tar powerguard-frtnd_image

#********************************************************************************
# *** RASPBERRY ***
#docker buildx build --platform linux/arm64 -f Dockerfile.arm64 -t powerguard-frtnd_image_arm64 --load .

#Spr. na raspberry
#docker image inspect powerguard-frtnd_image_arm64 --format "{{.Architecture}}"

#sudo docker save -o powerguard-frtnd-261017_arm64.tar powerguard-frtnd_image_arm64
#=================================================================================

#NA SERWERZE
#sudo docker load -i powerguard-frtnd_image-260930.tar 

#----------------------------------------------
#Spr. environments:
#docker run -it --rm powerguard-frtnd_image /bin/sh
#cd /app/dist/powerguard-frtnd
#cat environment.js

# --------------------
#stage 1  (build app)
#FROM node:lts AS node
#WORKDIR /app
#COPY . .

#RUN npm install

#RUN npm run build --prod 


# #stage 2  (serve app with nginx)
#FROM nginx:alpine
#COPY --from=node /app/dist/powerguard-frtnd/browser /usr/share/nginx/html

# Ensure the env.template.js file is copied to the correct location
#COPY public/env.template.js /usr/share/nginx/html/assets/env.template.js

# When the container starts, replace the env.js with values from environment variables
#CMD ["/bin/sh", "-c", "envsubst < /usr/share/nginx/html/env.template.js > /usr/share/nginx/html/env.js && exec nginx -g 'daemon off;'"]
#=====


# 1) build stage
FROM node:lts AS build
WORKDIR /app

# copy ONLY package files first -> install deps for LINUX
COPY package*.json ./
# if you also have pnpm-lock or yarn.lock, copy it here too

# install clean, in the container
RUN npm ci --omit=dev || npm install

# NOW copy the rest of the app
COPY . .

# make sure esbuild is rebuilt for linux
RUN npm rebuild esbuild

# run angular build (explicit production)
RUN npm run build -- --configuration production


### # 2) runtime stage
### FROM nginx:alpine
### # copy built Angular browser
### COPY --from=build /app/dist/powerguard-frtnd/browser /usr/share/nginx/html

### # copy env template to assets (keep it consistent!)
### COPY public/env.template.js /usr/share/nginx/html/env.template.js
### CMD ["/bin/sh", "-c", "envsubst < /usr/share/nginx/html/env.template.js > /usr/share/nginx/html/env.js && exec nginx -g 'daemon off;'"]

# 2) runtime stage
FROM nginx:alpine

# copy built Angular app
COPY --from=build /app/dist/powerguard-frtnd/browser /usr/share/nginx/html

# copy env template
COPY public/env.template.js /usr/share/nginx/html/env.template.js

# copy nginx config (override default)
COPY public/nginx/default.conf /etc/nginx/conf.d/default.conf

CMD ["/bin/sh", "-c", "envsubst < /usr/share/nginx/html/env.template.js > /usr/share/nginx/html/env.js && exec nginx -g 'daemon off;'"]
