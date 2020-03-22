FROM ubuntu-for-cvat

ARG http_proxy
ARG https_proxy
ARG no_proxy

ENV TERM=xterm \
    http_proxy=${http_proxy}   \
    https_proxy=${https_proxy} \
    no_proxy=${no_proxy}

ENV LANG='C.UTF-8'  \
    LC_ALL='C.UTF-8'

ARG USER
ARG DJANGO_CONFIGURATION
ENV DJANGO_CONFIGURATION=${DJANGO_CONFIGURATION}

# Add a non-root user
ENV USER=${USER}
ENV HOME /home/${USER}
WORKDIR ${HOME}
RUN adduser --shell /bin/bash --disabled-password --gecos "" ${USER}

COPY components /tmp/components

# OpenVINO toolkit support
ARG OPENVINO_TOOLKIT
ENV OPENVINO_TOOLKIT=${OPENVINO_TOOLKIT}
RUN if [ "$OPENVINO_TOOLKIT" = "yes" ]; then \
        /tmp/components/openvino/install.sh; \
    fi

# CUDA support
ARG CUDA_SUPPORT
ENV CUDA_SUPPORT=${CUDA_SUPPORT}
RUN if [ "$CUDA_SUPPORT" = "yes" ]; then \
        /tmp/components/cuda/install.sh; \
    fi

# Tensorflow annotation support
ARG TF_ANNOTATION
ENV TF_ANNOTATION=${TF_ANNOTATION}
ENV TF_ANNOTATION_MODEL_PATH=${HOME}/rcnn/inference_graph
RUN if [ "$TF_ANNOTATION" = "yes" ]; then \
        bash -i /tmp/components/tf_annotation/install.sh; \
    fi

# Install and initialize CVAT, copy all necessary files
COPY cvat/requirements/ /tmp/requirements/
COPY supervisord.conf mod_wsgi.conf wait-for-it.sh manage.py ${HOME}/
COPY cvat/ ${HOME}/cvat
COPY tests ${HOME}/tests
RUN patch -p1 < ${HOME}/cvat/apps/engine/static/engine/js/3rdparty.patch
RUN chown -R ${USER}:${USER} .

# RUN all commands below as 'django' user
USER ${USER}

RUN chmod +x /home/django/wait-for-it.sh

RUN mkdir data share media keys logs /tmp/supervisord
RUN python3 manage.py collectstatic

EXPOSE 8080 8443 3500
ENTRYPOINT ["/usr/bin/supervisord"]
